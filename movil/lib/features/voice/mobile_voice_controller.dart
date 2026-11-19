import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:record/record.dart';

import '../../core/models/protocol_message.dart';
import '../../core/session/helix_session.dart';

enum MobileVoiceMode { live, normal }

class VoiceConversationEntry {
  const VoiceConversationEntry({
    required this.role,
    required this.text,
    this.hadCode = false,
  });

  final String role;
  final String text;
  final bool hadCode;
}

class VoiceConfirmation {
  const VoiceConfirmation({
    required this.requestId,
    required this.action,
    required this.whatWillChange,
    required this.why,
    required this.level,
    required this.speechText,
  });

  final String requestId;
  final String action;
  final String whatWillChange;
  final String why;
  final String level;
  final String speechText;
}

class _SpeechClip {
  const _SpeechClip({required this.index, required this.bytes});

  final int index;
  final Uint8List bytes;
}

/// Owns one mobile voice conversation over the shared HELIX session.
///
/// Audio is captured as mono PCM16, sent through the already authenticated
/// transport, and never written to permanent storage. The controller only
/// accepts server voice events and never speaks code: it renders the full
/// assistant text while playback contains the backend's filtered speech text.
class MobileVoiceController extends ChangeNotifier {
  MobileVoiceController(this.session, {required this.relayAudio}) {
    _events = session.events.listen(_handleEvent);
    _player.onPlayerComplete.listen((_) => _onClipComplete());
  }

  static const int sampleRate = 16000;
  static const double bargeInThreshold = 0.035;

  final HelixSession session;
  final bool relayAudio;
  final AudioRecorder _recorder = AudioRecorder();
  final AudioPlayer _player = AudioPlayer();
  final Random _random = Random.secure();
  final List<VoiceConversationEntry> _entries = [];
  final List<_SpeechClip> _clips = [];

  late final StreamSubscription<HelixMessage> _events;
  StreamSubscription<Uint8List>? _audioSubscription;

  String state = 'IDLE';
  MobileVoiceMode mode = MobileVoiceMode.live;
  String? sessionId;
  String? error;
  String transcript = '';
  String? lastSpeechText;
  VoiceConfirmation? confirmation;
  bool active = false;
  bool capturing = false;
  bool muted = false;
  bool resolvingConfirmation = false;
  double level = 0;

  bool _disposed = false;
  bool _stopping = false;
  bool _speakingEnded = false;
  bool _playbackDoneSent = false;
  int _highestPlayedIndex = -1;
  int _bargeInFrames = 0;

  List<VoiceConversationEntry> get entries => List.unmodifiable(_entries);

  bool get canStart => !active && state != 'INITIALIZING';
  bool get normalReadyToStop => mode == MobileVoiceMode.normal && capturing;

  Future<void> start(MobileVoiceMode nextMode) async {
    if (active || state == 'INITIALIZING') return;
    mode = nextMode;
    error = null;
    transcript = '';
    _entries.clear();
    _clips.clear();
    _resetPlaybackState();
    state = 'INITIALIZING';
    active = true;
    sessionId = _newSessionId();
    _notify();
    try {
      await session.sendVoiceMessage('VOICE_SESSION_START', {
        'session_id': sessionId,
        'mode': mode == MobileVoiceMode.live ? 'live' : 'normal',
        'server_audio': false,
        'tts_enabled': true,
        'opening_greeting': mode == MobileVoiceMode.live,
        'silence_ms': 1000,
      });
    } on Object catch (cause) {
      active = false;
      state = 'ERROR';
      error = 'No se pudo iniciar la voz móvil: $cause';
      _notify();
    }
  }

  Future<void> stop() async {
    if (_stopping) return;
    _stopping = true;
    final id = sessionId;
    await _stopCapture();
    _clearPlayback();
    if (id != null && active) {
      try {
        await session.sendVoiceMessage(
          'VOICE_SESSION_STOP',
          {'session_id': id},
        );
      } on Object {
        // The transport may already be closed.
      }
    }
    active = false;
    capturing = false;
    state = 'CLOSED';
    sessionId = null;
    confirmation = null;
    transcript = '';
    _stopping = false;
    _notify();
  }

  Future<void> toggleMute() async {
    final id = sessionId;
    if (id == null || !active) return;
    muted = !muted;
    try {
      await session.sendVoiceMessage(
        muted ? 'VOICE_MUTE' : 'VOICE_UNMUTE',
        {'session_id': id},
      );
    } on Object catch (cause) {
      muted = !muted;
      error = 'No se pudo cambiar el micrófono: $cause';
    }
    _notify();
  }

  Future<void> stopNormalRecording() async {
    final id = sessionId;
    if (id == null || mode != MobileVoiceMode.normal || !capturing) return;
    state = 'PROCESSING';
    capturing = false;
    _notify();
    try {
      await session.sendVoiceMessage(
        'VOICE_RECORDING_STOP',
        {'session_id': id},
      );
    } on Object catch (cause) {
      error = 'No se pudo enviar la grabación: $cause';
      state = 'ERROR';
    }
    await _stopCapture();
    _notify();
  }

  Future<void> approveConfirmation() async {
    final pending = confirmation;
    final id = sessionId;
    if (pending == null || id == null) return;
    await _sendConfirmationDecision(id, pending.requestId, 'approve');
  }

  Future<void> rejectConfirmation() async {
    final pending = confirmation;
    final id = sessionId;
    if (pending == null || id == null) return;
    await _sendConfirmationDecision(id, pending.requestId, 'reject');
  }

  Future<void> sendConfirmationText(String text) async {
    final pending = confirmation;
    final id = sessionId;
    final value = text.trim();
    if (pending == null || id == null || value.isEmpty) return;
    resolvingConfirmation = true;
    error = null;
    _notify();
    try {
      await session.sendVoiceMessage('VOICE_CONFIRMATION_TEXT', {
        'session_id': id,
        'request_id': pending.requestId,
        'text': value,
      });
    } on Object catch (cause) {
      error = 'No se pudo enviar la respuesta: $cause';
    } finally {
      resolvingConfirmation = false;
      _notify();
    }
  }

  Future<void> _sendConfirmationDecision(
    String id,
    String requestId,
    String decision,
  ) async {
    resolvingConfirmation = true;
    error = null;
    _notify();
    try {
      await session.sendVoiceMessage('VOICE_CONFIRMATION', {
        'session_id': id,
        'request_id': requestId,
        'decision': decision,
      });
    } on Object catch (cause) {
      error = 'No se pudo resolver la confirmación: $cause';
    } finally {
      resolvingConfirmation = false;
      _notify();
    }
  }

  void _handleEvent(HelixMessage event) {
    var type = event.type;
    var payload = event.payload;
    if (type == 'VOICE_MESSAGE') {
      final voiceType = payload['voice_type'];
      final voicePayload = payload['voice_payload'];
      if (voiceType is! String || voicePayload is! Map) return;
      type = voiceType;
      payload = Map<String, dynamic>.from(voicePayload);
    }
    if (!type.startsWith('VOICE_')) return;

    switch (type) {
      case 'VOICE_SESSION_READY':
        active = true;
        state = mode == MobileVoiceMode.live ? 'LISTENING' : 'IDLE';
        error = null;
        _notify();
        unawaited(_startCapture());
        break;

      case 'VOICE_STATE':
        final next = payload['state'];
        if (next is String) {
          state = next;
          muted = next == 'MUTED';
          if (next == 'CLOSED') {
            active = false;
            capturing = false;
            unawaited(_stopCapture());
          }
          _notify();
          if (next == 'IDLE' &&
              mode == MobileVoiceMode.normal &&
              active &&
              !capturing) {
            unawaited(stop());
          }
        }
        break;

      case 'VOICE_TRANSCRIPT':
        final text = payload['text'];
        if (text is String) {
          if (payload['final'] == true) {
            transcript = text.trim();
            if (transcript.isNotEmpty && payload['empty'] != true) {
              _entries.add(VoiceConversationEntry(
                role: 'user',
                text: transcript,
              ));
            }
          } else {
            transcript = text;
          }
          _trimEntries();
          _notify();
        }
        break;

      case 'VOICE_ASSISTANT_TEXT':
        final text = payload['text'];
        final speech = payload['speech_text'];
        if (text is String && text.trim().isNotEmpty) {
          lastSpeechText = speech is String ? speech : text;
          _entries.add(VoiceConversationEntry(
            role: 'assistant',
            text: text.trim(),
            hadCode: payload['had_code'] == true,
          ));
          _trimEntries();
          _notify();
        }
        break;

      case 'VOICE_SPEECH_TEXT':
        final text = payload['text'];
        if (text is String && text.trim().isNotEmpty) {
          lastSpeechText = text.trim();
          _notify();
        }
        break;

      case 'VOICE_AUDIO_SEGMENT':
        final encoded = payload['audio_base64'];
        final index = payload['index'];
        if (encoded is String &&
            encoded.isNotEmpty &&
            encoded.length < 900000) {
          try {
            _clips.add(_SpeechClip(
              index: index is int ? index : 0,
              bytes: base64Decode(encoded),
            ));
            if (_clips.length == 1) unawaited(_playNext());
          } on FormatException {
            error = 'Helix envió un segmento de audio inválido.';
            _notify();
          }
        }
        break;

      case 'VOICE_SPEAKING_END':
        _speakingEnded = true;
        _maybeSendPlaybackDone();
        break;

      case 'VOICE_AUDIO_STOP':
      case 'VOICE_INTERRUPTED':
        _clearPlayback();
        if (state != 'INTERRUPTED') {
          state = 'INTERRUPTED';
          _notify();
        }
        break;

      case 'VOICE_CONFIRMATION_REQUEST':
        final requestId = payload['request_id'];
        if (requestId is String && requestId.isNotEmpty) {
          confirmation = VoiceConfirmation(
            requestId: requestId,
            action: _text(payload['action'], 'Acción pendiente'),
            whatWillChange: _text(payload['what_will_change'], ''),
            why: _text(payload['why'], ''),
            level: _text(payload['level'], 'medium'),
            speechText: _text(payload['speech_text'], ''),
          );
          state = 'AWAITING_CONFIRMATION';
          resolvingConfirmation = false;
          _notify();
        }
        break;

      case 'VOICE_CONFIRMATION_RESOLVED':
        confirmation = null;
        resolvingConfirmation = false;
        _notify();
        break;

      case 'VOICE_LEVEL':
        final next = payload['level'];
        if (next is num) {
          level = next.toDouble().clamp(0.0, 1.0);
          _notify();
        }
        break;

      case 'VOICE_ERROR':
        error = _text(payload['message'], 'Error en la sesión de voz.');
        if (payload['recoverable'] == false) {
          state = 'ERROR';
          active = false;
          unawaited(_stopCapture());
        }
        _notify();
        break;

      case 'VOICE_SESSION_CLOSED':
        active = false;
        capturing = false;
        confirmation = null;
        state = 'CLOSED';
        unawaited(_stopCapture());
        _clearPlayback();
        _notify();
        break;
    }
  }

  Future<void> _startCapture() async {
    if (_disposed || capturing || !active) return;
    try {
      if (!await _recorder.hasPermission()) {
        error =
            'HELIX necesita permiso de micrófono. Actívalo en Ajustes y vuelve a intentarlo.';
        state = 'ERROR';
        await stop();
        return;
      }
      final stream = await _recorder.startStream(const RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: sampleRate,
        numChannels: 1,
        echoCancel: true,
        noiseSuppress: true,
      ));
      capturing = true;
      _audioSubscription = stream.listen(
        _handleAudioChunk,
        onError: (Object cause) {
          error = 'El micrófono se detuvo: $cause';
          state = 'ERROR';
          capturing = false;
          _notify();
        },
      );
      _notify();
    } on Object catch (cause) {
      capturing = false;
      error =
          'No se pudo abrir el micrófono. Comprueba los permisos de la app. ($cause)';
      state = 'ERROR';
      _notify();
    }
  }

  Future<void> _stopCapture() async {
    final subscription = _audioSubscription;
    _audioSubscription = null;
    await subscription?.cancel();
    try {
      if (await _recorder.isRecording()) await _recorder.stop();
    } on Object {
      // The recorder can fail if the OS revoked the route; there is nothing
      // useful to keep alive after that.
    }
    capturing = false;
  }

  void _handleAudioChunk(Uint8List pcm) {
    final id = sessionId;
    if (_disposed || id == null || !active || muted || pcm.isEmpty) return;

    final rms = _calculateRms(pcm);
    level = (rms * 5).clamp(0.0, 1.0);
    _notify();

    if (state == 'SPEAKING' ||
        state == 'THINKING' ||
        state == 'PROCESSING') {
      if (rms > bargeInThreshold) {
        _bargeInFrames++;
        if (_bargeInFrames >= 2) {
          _bargeInFrames = 0;
          if (state == 'SPEAKING') _clearPlayback();
          state = 'INTERRUPTED';
          unawaited(session.sendVoiceMessage(
            'VOICE_INTERRUPT',
            {'session_id': id},
          ));
          _notify();
        }
      } else {
        _bargeInFrames = 0;
        return;
      }
    } else {
      _bargeInFrames = 0;
      if (state != 'LISTENING' &&
          state != 'INTERRUPTED' &&
          state != 'AWAITING_CONFIRMATION' &&
          !(mode == MobileVoiceMode.normal && capturing)) {
        return;
      }
    }

    // PCM16 chunks can occasionally split a sample. Keep bytes aligned.
    final aligned =
        pcm.length.isEven ? pcm : Uint8List.sublistView(pcm, 0, pcm.length - 1);
    if (aligned.isEmpty) return;
    unawaited(session.sendVoiceMessage('VOICE_AUDIO_CHUNK', {
      'session_id': id,
      'audio_base64': base64Encode(aligned),
      'sample_rate': sampleRate,
      'channels': 1,
    }));
  }

  double _calculateRms(Uint8List bytes) {
    final length = bytes.length ~/ 2;
    if (length == 0) return 0;
    final data = ByteData.sublistView(bytes, 0, length * 2);
    var sum = 0.0;
    for (var i = 0; i < length; i++) {
      final sample = data.getInt16(i * 2, Endian.little) / 32768.0;
      sum += sample * sample;
    }
    return sqrt(sum / length);
  }

  Future<void> _playNext() async {
    if (_clips.isEmpty || _disposed) {
      _maybeSendPlaybackDone();
      return;
    }
    final clip = _clips.first;
    try {
      await _player.play(
        BytesSource(clip.bytes, mimeType: 'audio/wav'),
        volume: 1.0,
      );
    } on Object catch (cause) {
      _clips.removeAt(0);
      error = 'No se pudo reproducir la respuesta: $cause';
      _notify();
      unawaited(_playNext());
    }
  }

  void _onClipComplete() {
    if (_disposed) return;
    if (_clips.isNotEmpty) {
      final played = _clips.removeAt(0);
      _highestPlayedIndex = max(_highestPlayedIndex, played.index);
    }
    unawaited(_playNext());
  }

  void _maybeSendPlaybackDone() {
    final id = sessionId;
    if (_playbackDoneSent ||
        !_speakingEnded ||
        _clips.isNotEmpty ||
        id == null ||
        !active) {
      return;
    }
    _playbackDoneSent = true;
    unawaited(session.sendVoiceMessage('VOICE_PLAYBACK_DONE', {
      'session_id': id,
      'last_index': _highestPlayedIndex,
      'interrupted': false,
    }));
  }

  void _resetPlaybackState() {
    _speakingEnded = false;
    _playbackDoneSent = false;
    _highestPlayedIndex = -1;
    _bargeInFrames = 0;
  }

  void _clearPlayback() {
    _clips.clear();
    _resetPlaybackState();
    unawaited(_player.stop());
  }

  String _newSessionId() {
    final stamp = DateTime.now().microsecondsSinceEpoch.toRadixString(36);
    final suffix = _random.nextInt(1 << 32).toRadixString(36);
    return 'mobile_voice_${stamp}_$suffix';
  }

  String _text(Object? value, String fallback) =>
      value is String && value.trim().isNotEmpty ? value.trim() : fallback;

  void _trimEntries() {
    if (_entries.length > 8) {
      _entries.removeRange(0, _entries.length - 8);
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    unawaited(_events.cancel());
    unawaited(_stopCapture());
    unawaited(_player.dispose());
    unawaited(_recorder.dispose());
    super.dispose();
  }
}
