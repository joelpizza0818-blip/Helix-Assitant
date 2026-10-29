import 'dart:math';

import '../config/mobile_config.dart';
import '../transport/ssh_tunnel.dart';
import '../transport/websocket_transport.dart';
import '../transport/worker_relay_pairing.dart';
import 'helix_session.dart';

/// Owns the native transport chain used by the mobile app. A relay connects
/// directly over WSS; SSH mode first binds a loopback forward and then speaks
/// the same authenticated HELIX WebSocket protocol through it.
class MobileConnection {
  MobileConnection({SshTunnelManager? ssh})
      : _ssh = ssh ?? SshTunnelManagerImpl();

  final SshTunnelManager _ssh;
  static const _deviceIdCharacters =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  final String _sourceDeviceId = _createSourceDeviceId();
  HelixSession? session;
  String? authenticatedToken;

  static String _createSourceDeviceId() {
    final random = Random.secure();
    return List.generate(
      32,
      (_) => _deviceIdCharacters[random.nextInt(_deviceIdCharacters.length)],
    ).join();
  }

  Future<HelixSession> connect(MobileConfig config, String token) async {
    final invitationExpiresAt = config.invitationExpiresAt;
    if (invitationExpiresAt != null &&
        !invitationExpiresAt.isAfter(DateTime.now())) {
      throw StateError(
        'The HELIX pairing invitation has expired.',
      );
    }
    await close();
    Uri uri;
    var sessionToken = token;
    if (config.mode == MobileTransportMode.sshTunnel) {
      final localPort = await _ssh.open(config.desktop, localPort: 0);
      uri = Uri(scheme: 'ws', host: '127.0.0.1', port: localPort);
    } else {
      final relay = config.relayWssUrl;
      if (relay == null || relay.isEmpty) {
        throw StateError('A relay WSS URL is required.');
      }
      uri = Uri.parse(relay);
      if (config.requiresDeviceApproval) {
        sessionToken = await WorkerRelayPairingClient(
          uri: uri,
          invitationToken: token,
        ).pair();
      }
    }
    final transport = WebSocketHelixTransport(uri: uri, token: sessionToken);
    final nextSession = HelixSession(
      transport,
      requestTimeout: config.requestTimeout,
      sourceDeviceId: _sourceDeviceId,
      relaySkillsRequests: config.mode == MobileTransportMode.relay,
    );
    session = nextSession;
    await nextSession.connect();
    authenticatedToken = sessionToken;
    return nextSession;
  }

  Future<void> close() async {
    await session?.close();
    session = null;
    authenticatedToken = null;
    await _ssh.close();
  }
}
