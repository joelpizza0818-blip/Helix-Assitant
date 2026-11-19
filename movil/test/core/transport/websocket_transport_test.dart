import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:helix_mobile/core/transport/helix_transport.dart';
import 'package:helix_mobile/core/transport/websocket_transport.dart';

void main() {
  test('stops reconnecting after repeated short-lived WebSocket sessions',
      () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    var connectionCount = 0;
    final serverSubscription = server.listen((request) async {
      connectionCount++;
      final socket = await WebSocketTransformer.upgrade(request);
      await Future<void>.delayed(const Duration(milliseconds: 10));
      await socket.close();
    });
    final transport = WebSocketHelixTransport(
      uri: Uri(
        scheme: 'ws',
        host: InternetAddress.loopbackIPv4.address,
        port: server.port,
      ),
      token: 'test-token-with-more-than-forty-characters-123456',
      maxReconnectAttempts: 1,
    );
    final states = <TransportState>[];
    final disconnected = Completer<void>();
    final stateSubscription = transport.states.listen((state) {
      states.add(state);
      if (state == TransportState.disconnected &&
          states.contains(TransportState.reconnecting) &&
          !disconnected.isCompleted) {
        disconnected.complete();
      }
    });

    try {
      await transport.connect();
      await disconnected.future.timeout(const Duration(seconds: 5));

      expect(connectionCount, 2);
      expect(states, contains(TransportState.reconnecting));
      expect(states.last, TransportState.disconnected);
    } finally {
      await transport.close();
      await stateSubscription.cancel();
      await serverSubscription.cancel();
      await server.close(force: true);
    }
  });
}
