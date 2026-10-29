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

  test('requests subagent data over a direct desktop session', () async {
    final transport = _SkillsTransport();
    final session = HelixSession(transport);

    final profiles = await session.requestSubagents('list_profiles');

    expect(transport.sent.single.type, 'GET_SUBAGENT_PROFILES');
    expect(profiles['items'], isEmpty);
    await session.close();
  });

  test('correlates relay subagent responses and exposes browser controls',
      () async {
    final transport = _SkillsTransport();
    final session = HelixSession(transport, relaySkillsRequests: true);

    final pending = session.requestSubagents('chat',
        profileId: 'research', message: 'Summarize this');
    final request = transport.sent.single;
    expect(request.type, 'SUBAGENT_QUERY');
    expect(request.payload['action'], 'chat');
    expect(request.payload['profile_id'], 'research');

    transport.respond(HelixMessage(
      type: 'subagent_response',
      payload: {
        'correlation_id': request.payload['correlation_id'],
        'result': {'response': 'Ready'},
      },
    ));
    expect(await pending, {'response': 'Ready'});

    await session.setBrowserLivePaused(true);
    expect(transport.sent.last.type, 'BROWSER_LIVE_CONTROL');
    expect(transport.sent.last.payload['paused'], isTrue);
    await session.close();
  });

  test('does not send browser live controls over SSH sessions', () async {
    final session = HelixSession(_SkillsTransport());

    expect(() => session.setBrowserLivePaused(true), throwsStateError);

    await session.close();
  });

  test('uses the relay device id announced on an authenticated reconnect',
      () async {
    final transport = _SkillsTransport();
    final session = HelixSession(transport, relaySkillsRequests: true);

    transport.respond(const HelixMessage(
      type: 'HELIX_DEVICE_READY',
      payload: {'device_id': 'abcdefghijklmnopqrstuvwxyz123456'},
    ));

    expect(session.sourceDeviceId, 'abcdefghijklmnopqrstuvwxyz123456');
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
    } else if (message.type == 'GET_SUBAGENT_PROFILES') {
      _messages.add(HelixMessage(
        type: message.type,
        requestId: message.requestId,
        payload: {'items': <Map<String, dynamic>>[]},
      ));
    }
  }

  void respond(HelixMessage message) => _messages.add(message);

  @override
  Future<void> close() => _messages.close();
}
