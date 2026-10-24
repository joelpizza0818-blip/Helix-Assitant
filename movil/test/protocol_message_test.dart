import 'package:flutter_test/flutter_test.dart';
import 'package:helix_mobile/core/models/protocol_message.dart';

void main() {
  test('decodes a correlated response', () {
    final message = HelixMessage.fromJson(
      '{"type":"GET_TASKS","request_id":"abc","payload":{"tasks":[]}}',
    );
    expect(message.type, 'GET_TASKS');
    expect(message.requestId, 'abc');
    expect(message.payload['tasks'], isEmpty);
  });

  test('rejects a non-object message', () {
    expect(() => HelixMessage.fromJson('[]'), throwsFormatException);
  });
}
