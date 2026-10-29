import 'dart:async';
import 'dart:math';

import '../models/protocol_message.dart';
import '../transport/helix_transport.dart';

class HelixSession {
  HelixSession(
    this.transport, {
    this.requestTimeout = const Duration(seconds: 30),
    this.sourceDeviceId,
    this.relaySkillsRequests = false,
  }) {
    _subscription = transport.messages.listen(_handleMessage);
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

  Future<void> sendUserText(
          {required String text, required String conversationId}) =>
      transport.send(
        HelixMessage(
          type: 'USER_TEXT',
          payload: {
            'text': text,
            'conversation_id': sourceDeviceId == null
                ? conversationId
                : 'mobile_$sourceDeviceId',
            'conversation_history': const <Map<String, String>>[],
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
        action == 'chat' ? const Duration(minutes: 2) : requestTimeout,
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
