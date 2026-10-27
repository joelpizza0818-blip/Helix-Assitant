import 'package:flutter_test/flutter_test.dart';
import 'package:helix_mobile/core/transport/websocket_channel_factory_stub.dart';

void main() {
  test('rejects authenticated websocket connections on web targets', () {
    expect(
      () => connectAuthenticatedWebSocket(
        Uri.parse('wss://relay.example.test'),
        'pairing-secret',
      ),
      throwsA(isA<UnsupportedError>()),
    );
  });
}
