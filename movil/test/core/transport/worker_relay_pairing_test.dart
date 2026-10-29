import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:helix_mobile/core/transport/worker_relay_pairing.dart';

void main() {
  test('waits for Desktop approval and returns both device credentials',
      () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final authorization = Completer<String?>();
    final serverSocket = Completer<WebSocket>();
    final serving = server.listen((request) async {
      authorization
          .complete(request.headers.value(HttpHeaders.authorizationHeader));
      final socket = await WebSocketTransformer.upgrade(request);
      serverSocket.complete(socket);
      socket.add(jsonEncode({
        'type': 'HELIX_PAIRING_PENDING',
        'payload': {'request_id': 'pending-123'},
      }));
      await Future<void>.delayed(const Duration(milliseconds: 10));
      socket.add(jsonEncode({
        'type': 'HELIX_PAIRING_APPROVED',
        'payload': {
          'device_id': 'abcdefghijklmnopqrstuvwxyz123456',
          'device_token': 'abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG',
        },
      }));
    });

    final client = WorkerRelayPairingClient(
      uri: Uri(
        scheme: 'ws',
        host: InternetAddress.loopbackIPv4.address,
        port: server.port,
        path: '/v1/rooms/abcdefghijklmnopqrstuvwxyz123456/socket',
      ),
      invitationToken: 'invitation-token-value-with-at-least-forty-characters',
    );

    try {
      final credentials = await client.pair();
      expect(credentials.deviceId, 'abcdefghijklmnopqrstuvwxyz123456');
      expect(credentials.deviceToken,
          'abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG');
      expect(
        await authorization.future,
        'Bearer invitation-token-value-with-at-least-forty-characters',
      );
    } finally {
      if (serverSocket.isCompleted) await (await serverSocket.future).close();
      await serving.cancel();
      await server.close(force: true);
    }
  });
}
