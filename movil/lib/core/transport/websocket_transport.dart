import 'dart:async';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'websocket_channel_factory.dart';

import '../models/protocol_message.dart';
import 'helix_transport.dart';

class WebSocketHelixTransport implements HelixTransport {
  WebSocketHelixTransport({required this.uri, required this.token});

  final Uri uri;
  final String token;
  final _messages = StreamController<HelixMessage>.broadcast();
  final _states = StreamController<TransportState>.broadcast();
  WebSocketChannel? _channel;

  @override
  Stream<HelixMessage> get messages => _messages.stream;

  @override
  Stream<TransportState> get states => _states.stream;

  @override
  Future<void> connect() async {
    _states.add(TransportState.connecting);
    final channel = connectAuthenticatedWebSocket(uri, token);
    _channel = channel;
    await channel.ready.timeout(
      const Duration(seconds: 12),
      onTimeout: () => throw TimeoutException('HELIX relay did not respond within 12 seconds'),
    );
    _states.add(TransportState.connected);
    channel.stream.listen(
      (value) {
        try {
          _messages.add(HelixMessage.fromJson(value as String));
        } on Object catch (error, stackTrace) {
          _messages.addError(error, stackTrace);
        }
      },
      onError: (Object error, StackTrace stackTrace) {
        _states.add(TransportState.failed);
        _messages.addError(error, stackTrace);
      },
      onDone: () => _states.add(TransportState.disconnected),
    );
  }

  @override
  Future<void> send(HelixMessage message) async {
    final channel = _channel;
    if (channel == null) throw StateError('HELIX transport is not connected');
    channel.sink.add(message.toJson());
  }

  @override
  Future<void> close() async {
    await _channel?.sink.close();
    await _messages.close();
    await _states.close();
  }
}
