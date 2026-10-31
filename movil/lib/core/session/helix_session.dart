import 'dart:async';
import 'dart:math';

import '../models/protocol_message.dart';
import '../transport/helix_transport.dart';

class HelixSession {
  static const _subagentChatTimeout = Duration(minutes: 20);

  HelixSession(
    this.transport, {
    this.requestTimeout = const Duration(seconds: 30),
    this.sourceDeviceId,
    this.relaySkillsRequests = false,
  }) {
    _subscription = transport.messages.listen(
      _handleMessage,
      onError: (Object error) {
        // Prevent unhandled async stream error in message dispatcher
      },
    );
  }

  final HelixTransport transport;
  final Duration requestTimeout;
  String? sourceDeviceId;
  final bool relaySkillsRequests;
  final _events = StreamController<HelixMessage>.broadcast();
  final _pending = <String, Completer<HelixMessage>>{};
  final _pendingRelayRequests = <String, Completer<Map<String, dynamic>>>{};
  late final StreamSubscription<HelixMessage> _subscription;
  final _random = Random.secure();

  Stream<HelixMessage> get events => _events.stream;
  Stream<TransportState> get states => transport.states;

  Future<void> connect() => transport.connect();

  Future<HelixMessage> request(String type,
      [Map<String, dynamic> payload = const {}]) async {
    final requestId =
        '${DateTime.now().microsecondsSinceEpoch}-${_random.nextInt(1 << 32)}';
    final completer = Completer<HelixMessage>();
    _pending[requestId] = completer;
    try {
      await transport.send(
          HelixMessage(type: type, requestId: requestId, payload: payload));
      return await completer.future.timeout(requestTimeout);
    } finally {
      _pending.remove(requestId);
    }
  }

  Future<void> sendUserText({
    required String text,
    required String conversationId,
    List<Map<String, dynamic>>? attachments,
    String? model,
  }) =>
      transport.send(
        HelixMessage(
          type: 'USER_TEXT',
          payload: {
            'text': text,
            'conversation_id': sourceDeviceId == null
                ? conversationId
                : 'mobile_$sourceDeviceId',
            'conversation_history': const <Map<String, String>>[],
            if (attachments != null && attachments.isNotEmpty)
              'attachments': attachments,
            if (model != null && model.isNotEmpty)
              'model': model,
            if (sourceDeviceId != null) ...{
              'input_source': 'mobile',
              'source_device_id': sourceDeviceId,
            },
          },
        ),
      );

  Future<List<Map<String, dynamic>>> requestSkills() async {
    if (relaySkillsRequests) {
      await transport.send(const HelixMessage(type: 'SKILLS_REQUEST'));
      return const [];
    }
    final response = await request('GET_SKILLS');
    final skills = response.payload['skills'];
    if (skills is! List) {
      throw const FormatException(
          'HELIX Desktop returned an invalid skills list.');
    }
    return skills
        .whereType<Map>()
        .map((skill) => Map<String, dynamic>.from(skill))
        .toList(growable: false);
  }

  Future<Map<String, dynamic>> requestSubagents(
    String action, {
    String? profileId,
    String? message,
  }) async {
    if (!{'list_profiles', 'get_status', 'chat'}.contains(action)) {
      throw ArgumentError.value(
          action, 'action', 'Unsupported subagent action');
    }
    if (!relaySkillsRequests) {
      final type = switch (action) {
        'list_profiles' => 'GET_SUBAGENT_PROFILES',
        'get_status' => 'GET_SUBAGENT_STATUS',
        _ => 'CHAT_SUBAGENT',
      };
      final response = await request(type, {
        if (profileId != null) 'profile_id': profileId,
        if (message != null) 'message': message,
      });
      return response.payload;
    }

    final correlationId =
        '${DateTime.now().microsecondsSinceEpoch}-${_random.nextInt(1 << 32)}';
    final completer = Completer<Map<String, dynamic>>();
    _pendingRelayRequests[correlationId] = completer;
    try {
      await transport.send(HelixMessage(
        type: 'SUBAGENT_QUERY',
        payload: {
          'action': action,
          'correlation_id': correlationId,
          if (profileId != null) 'profile_id': profileId,
          if (message != null) 'message': message,
        },
      ));
      return await completer.future.timeout(
        action == 'chat' ? _subagentChatTimeout : requestTimeout,
      );
    } finally {
      _pendingRelayRequests.remove(correlationId);
    }
  }

  Future<void> setBrowserLivePaused(bool paused) {
    if (!relaySkillsRequests) {
      throw StateError('Browser live view requires a relay connection.');
    }
    return transport.send(HelixMessage(
      type: 'BROWSER_LIVE_CONTROL',
      payload: {'paused': paused},
    ));
  }

  Future<void> startDesktopStream({int fps = 10}) {
    return transport.send(HelixMessage(
      type: 'DESKTOP_STREAM_START',
      payload: {
        if (sourceDeviceId != null) 'source_device_id': sourceDeviceId,
        'fps': fps,
      },
    ));
  }

  Future<void> stopDesktopStream() {
    return transport.send(HelixMessage(
      type: 'DESKTOP_STREAM_STOP',
      payload: {
        if (sourceDeviceId != null) 'source_device_id': sourceDeviceId,
      },
    ));
  }

  Future<void> sendRemoteMouseEvent({
    required String action,
    double? xRatio,
    double? yRatio,
    String button = 'left',
    int amount = 0,
  }) {
    return transport.send(HelixMessage(
      type: 'REMOTE_CONTROL_MOUSE',
      payload: {
        'action': action,
        if (xRatio != null) 'x_ratio': xRatio,
        if (yRatio != null) 'y_ratio': yRatio,
        'button': button,
        'amount': amount,
        if (sourceDeviceId != null) 'source_device_id': sourceDeviceId,
      },
    ));
  }

  Future<void> sendRemoteKeyboardInput({
    String? text,
    String? key,
  }) {
    return transport.send(HelixMessage(
      type: 'REMOTE_CONTROL_KEYBOARD',
      payload: {
        if (text != null) 'text': text,
        if (key != null) 'key': key,
        if (sourceDeviceId != null) 'source_device_id': sourceDeviceId,
      },
    ));
  }

  Future<void> sendConfirmationResponse({
    required String requestId,
    required bool approved,
  }) =>
      transport.send(
        HelixMessage(
          type: 'CONFIRMATION_RESPONSE',
          payload: {
            'request_id': requestId,
            'approved': approved,
            if (sourceDeviceId != null) 'source_device_id': sourceDeviceId,
          },
        ),
      );

  Future<void> cancelTask(String taskId) => transport.send(
        HelixMessage(type: 'TASK_CANCEL', payload: {'task_id': taskId}),
      );

  void _handleMessage(HelixMessage message) {
    if (message.type == 'HELIX_DEVICE_READY') {
      final deviceId = message.payload['device_id'];
      if (deviceId is String &&
          RegExp(r'^[A-Za-z0-9_-]{20,64}$').hasMatch(deviceId)) {
        sourceDeviceId = deviceId;
      }
    }
    if (message.type == 'subagent_response') {
      final correlationId = message.payload['correlation_id'];
      final completer =
          correlationId is String ? _pendingRelayRequests[correlationId] : null;
      if (completer != null && !completer.isCompleted) {
        if (message.payload['error'] is String) {
          completer
              .completeError(StateError(message.payload['error'] as String));
        } else {
          final result = message.payload['result'];
          if (result is Map<String, dynamic>) {
            completer.complete(result);
          } else {
            completer.completeError(
              const FormatException(
                  'HELIX returned an invalid subagent result.'),
            );
          }
        }
        return;
      }
    }
    final requestId = message.requestId;
    final pending = requestId == null ? null : _pending[requestId];
    if (pending != null && !pending.isCompleted) {
      if (message.error != null) {
        pending.completeError(StateError(message.error!));
      } else {
        pending.complete(message);
      }
      return;
    }
    _events.add(message);
  }

  Future<void> close() async {
    await _subscription.cancel();
    for (final pending in _pending.values) {
      if (!pending.isCompleted) {
        pending.completeError(StateError('HELIX session closed'));
      }
    }
    _pending.clear();
    for (final pending in _pendingRelayRequests.values) {
      if (!pending.isCompleted) {
        pending.completeError(StateError('HELIX session closed'));
      }
    }
    _pendingRelayRequests.clear();
    await _events.close();
    await transport.close();
  }
}
