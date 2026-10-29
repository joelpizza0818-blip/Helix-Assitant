import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:helix_mobile/core/models/protocol_message.dart';
import 'package:helix_mobile/core/session/helix_session.dart';
import 'package:helix_mobile/core/transport/helix_transport.dart';

void main() {
  test('requests skill suggestions over a direct desktop session', () async {
    final transport = _SkillsTransport();
    final session = HelixSession(transport);

    final skills = await session.requestSkills();

    expect(transport.sent.single.type, 'GET_SKILLS');
    expect(skills.single['name'], 'research');
    await session.close();
  });

  test('requests the relay skill catalog without forwarding arbitrary payload',
      () async {
    final transport = _SkillsTransport();
    final session = HelixSession(transport, relaySkillsRequests: true);

    expect(await session.requestSkills(), isEmpty);
    expect(transport.sent.single.type, 'SKILLS_REQUEST');
    expect(transport.sent.single.requestId, isNull);
    await session.close();
  });
}

class _SkillsTransport implements HelixTransport {
  final _messages = StreamController<HelixMessage>.broadcast(sync: true);
  final sent = <HelixMessage>[];

  @override
  Stream<HelixMessage> get messages => _messages.stream;

  @override
  Stream<TransportState> get states => const Stream.empty();

  @override
  Future<void> connect() async {}

  @override
  Future<void> send(HelixMessage message) async {
    sent.add(message);
    if (message.type == 'GET_SKILLS') {
      _messages.add(HelixMessage(
        type: 'GET_SKILLS',
        requestId: message.requestId,
        payload: {
          'skills': [
            {'name': 'research', 'description': 'Research a topic.'},
          ],
        },
      ));
    }
  }

  @override
  Future<void> close() => _messages.close();
}
