import 'dart:convert';
import 'dart:async';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'websocket_channel_factory.dart';

import '../models/protocol_message.dart';
import 'helix_transport.dart';

class WebSocketHelixTransport implements HelixTransport {
  WebSocketHelixTransport({
    required this.uri,
    required this.token,
    int maxReconnectAttempts = _defaultMaxReconnectAttempts,
  })  : _maxReconnectAttempts = maxReconnectAttempts,
        assert(maxReconnectAttempts > 0) {
    if (maxReconnectAttempts < 1) {
      throw ArgumentError.value(
        maxReconnectAttempts,
        'maxReconnectAttempts',
        'Must be greater than zero.',
      );
    }
  }

  final Uri uri;
  final String token;
  final int _maxReconnectAttempts;
  final _messages = StreamController<HelixMessage>.broadcast();
  final _states = StreamController<TransportState>.broadcast();
  WebSocketChannel? _channel;
  Timer? _reconnectTimer;
  bool _closed = false;
  int _reconnectAttempt = 0;
  DateTime? _connectedSince;
  static const _defaultMaxReconnectAttempts = 8;
  static const _stableConnectionWindow = Duration(seconds: 30);

  @override
  Stream<HelixMessage> get messages => _messages.stream;

  @override
  Stream<TransportState> get states => _states.stream;

  @override
  Future<void> connect() async {
    if (_closed) throw StateError('HELIX transport is closed');
    _reconnectAttempt = 0;
    _connectedSince = null;
    _states.add(TransportState.connecting);
    await _open();
  }

  Future<void> _open() async {
    if (_closed) return;
    final channel = connectAuthenticatedWebSocket(uri, token);
    _channel = channel;
    try {
      await channel.ready.timeout(
        const Duration(seconds: 12),
        onTimeout: () => throw TimeoutException(
          'HELIX relay did not respond within 12 seconds',
        ),
      );
    } on Object {
      if (identical(_channel, channel)) _channel = null;
      await channel.sink.close();
      rethrow;
    }
    if (_closed) {
      await channel.sink.close();
      return;
    }
    _connectedSince = DateTime.now();
    _states.add(TransportState.connected);
    channel.stream.listen(
      (value) {
        try {
          final text = value is String ? value : (value is List<int> ? utf8.decode(value) : value.toString());
          _messages.add(HelixMessage.fromJson(text));
        } on Object catch (error, stackTrace) {
          _messages.addError(error, stackTrace);
        }
      },
      onError: (Object error, StackTrace stackTrace) {
        _messages.addError(error, stackTrace);
        _scheduleReconnect();
      },
      onDone: () {
        if (identical(_channel, channel)) _channel = null;
        if (!_closed) _scheduleReconnect();
      },
    );
  }

  void _scheduleReconnect() {
    if (_closed || _reconnectTimer != null) return;
    final connectedSince = _connectedSince;
    if (connectedSince != null &&
        DateTime.now().difference(connectedSince) >=
            _stableConnectionWindow) {
      _reconnectAttempt = 0;
    }
    _connectedSince = null;
    if (_reconnectAttempt >= _maxReconnectAttempts) {
      _states.add(TransportState.disconnected);
      return;
    }
    _states.add(TransportState.reconnecting);
    final exponent = _reconnectAttempt.clamp(0, 5);
    final delay = Duration(seconds: 1 << exponent);
    _reconnectAttempt++;
    _reconnectTimer = Timer(delay, () {
      _reconnectTimer = null;
      unawaited(_retryConnect());
    });
  }

  Future<void> _retryConnect() async {
    if (_closed) return;
    try {
      await _open();
    } on Object catch (error, stackTrace) {
      if (_closed) return;
      _messages.addError(error, stackTrace);
      _scheduleReconnect();
    }
  }

  @override
  Future<void> send(HelixMessage message) async {
    final channel = _channel;
    if (_closed || channel == null) {
      throw StateError('HELIX transport is not connected');
    }
    channel.sink.add(message.toJson());
  }

  @override
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _states.add(TransportState.disconnected);
    await _channel?.sink.close();
    _channel = null;
    await _messages.close();
    await _states.close();
  }
}
