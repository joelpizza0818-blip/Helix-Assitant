import 'dart:async';
import 'dart:math';

import '../models/protocol_message.dart';
import '../transport/helix_transport.dart';

class HelixSession {
  HelixSession(this.transport, {this.requestTimeout = const Duration(seconds: 30)}) {
    _subscription = transport.messages.listen(_handleMessage);
  }

  final HelixTransport transport;
  final Duration requestTimeout;
  final _events = StreamController<HelixMessage>.broadcast();
  final _pending = <String, Completer<HelixMessage>>{};
  late final StreamSubscription<HelixMessage> _subscription;
  final _random = Random.secure();

  Stream<HelixMessage> get events => _events.stream;
  Stream<TransportState> get states => transport.states;

  Future<void> connect() => transport.connect();

  Future<HelixMessage> request(String type, [Map<String, dynamic> payload = const {}]) async {
    final requestId = '${DateTime.now().microsecondsSinceEpoch}-${_random.nextInt(1 << 32)}';
    final completer = Completer<HelixMessage>();
    _pending[requestId] = completer;
    await transport.send(HelixMessage(type: type, requestId: requestId, payload: payload));
    try {
      return await completer.future.timeout(requestTimeout);
    } finally {
      _pending.remove(requestId);
    }
  }

  Future<void> sendUserText({required String text, required String conversationId}) => transport.send(
        HelixMessage(
          type: 'USER_TEXT',
          payload: {
            'text': text,
            'conversation_id': conversationId,
            'conversation_history': const <Map<String, String>>[],
          },
        ),
      );

  Future<void> cancelTask(String taskId) => transport.send(
        HelixMessage(type: 'TASK_CANCEL', payload: {'task_id': taskId}),
      );

  void _handleMessage(HelixMessage message) {
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
      if (!pending.isCompleted) pending.completeError(StateError('HELIX session closed'));
    }
    _pending.clear();
    await _events.close();
    await transport.close();
  }
}
