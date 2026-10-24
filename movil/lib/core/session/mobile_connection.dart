import '../config/mobile_config.dart';
import '../transport/ssh_tunnel.dart';
import '../transport/websocket_transport.dart';
import 'helix_session.dart';

/// Owns the native transport chain used by the mobile app. A relay connects
/// directly over WSS; SSH mode first binds a loopback forward and then speaks
/// the same authenticated HELIX WebSocket protocol through it.
class MobileConnection {
  MobileConnection({SshTunnelManager? ssh}) : _ssh = ssh ?? SshTunnelManagerImpl();

  final SshTunnelManager _ssh;
  HelixSession? session;

  Future<HelixSession> connect(MobileConfig config, String token) async {
    await close();
    Uri uri;
    if (config.mode == MobileTransportMode.sshTunnel) {
      final localPort = await _ssh.open(config.desktop, localPort: 0);
      uri = Uri(scheme: 'ws', host: '127.0.0.1', port: localPort);
    } else {
      final relay = config.relayWssUrl;
      if (relay == null || relay.isEmpty) throw StateError('A relay WSS URL is required.');
      uri = Uri.parse(relay);
    }
    final transport = WebSocketHelixTransport(uri: uri, token: token);
    final nextSession = HelixSession(transport, requestTimeout: config.requestTimeout);
    session = nextSession;
    await nextSession.connect();
    return nextSession;
  }

  Future<void> close() async {
    await session?.close();
    session = null;
    await _ssh.close();
  }
}

