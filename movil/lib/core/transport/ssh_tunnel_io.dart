import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dartssh2/dartssh2.dart';

import '../config/mobile_config.dart';

abstract interface class SshTunnelManager {
  Future<int> open(DesktopConfig config, {required int localPort});
  Future<void> close();
}

/// Native SSH local-forwarding bridge. It binds a loopback port on the phone,
/// forwards each accepted TCP connection to the Desktop agent's loopback
/// WebSocket port, and never exposes the agent port on the network interface.
class SshTunnelManagerImpl implements SshTunnelManager {
  SSHClient? _client;
  ServerSocket? _listener;
  final _forwards = <SSHForwardChannel>{};

  @override
  Future<int> open(DesktopConfig config, {required int localPort}) async {
    await close();
    if (config.identityKeyPem == null ||
        config.identityKeyPem!.trim().isEmpty) {
      throw StateError(
          'An SSH private key is required for the Desktop tunnel.');
    }

    final socket = await SSHSocket.connect(config.host, config.sshPort);
    final keys =
        SSHKeyPair.fromPem(config.identityKeyPem!, config.identityPassphrase);
    final client = SSHClient(
      socket,
      username: config.sshUser,
      identities: keys,
      onVerifyHostKey: (type, fingerprint) {
        final expected = config.hostKeyFingerprint?.trim();
        if (expected == null || expected.isEmpty) return false;
        final opensshFingerprint =
            utf8.decode(fingerprint, allowMalformed: true);
        return opensshFingerprint == expected || _hex(fingerprint) == expected;
      },
    );
    _client = client;
    await client.authenticated;

    final listener =
        await ServerSocket.bind(InternetAddress.loopbackIPv4, localPort);
    _listener = listener;
    unawaited(_acceptLoop(listener, client, config));
    return listener.port;
  }

  String _hex(List<int> bytes) =>
      bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join(':');

  Future<void> _acceptLoop(
      ServerSocket listener, SSHClient client, DesktopConfig config) async {
    try {
      await for (final localSocket in listener) {
        if (!identical(listener, _listener)) {
          await localSocket.close();
          break;
        }
        try {
          final forward = await client.forwardLocal(
              config.remoteWsHost, config.remoteWsPort);
          _forwards.add(forward);
          unawaited(forward.stream.cast<List<int>>().pipe(localSocket));
          unawaited(localSocket.cast<List<int>>().pipe(forward.sink));
          unawaited(forward.done.whenComplete(() async {
            _forwards.remove(forward);
            await localSocket.close();
          }));
        } catch (_) {
          await localSocket.close();
        }
      }
    } on Object {
      await listener.close();
    }
  }

  @override
  Future<void> close() async {
    final listener = _listener;
    _listener = null;
    await listener?.close();
    for (final forward in List<SSHForwardChannel>.from(_forwards)) {
      await forward.close();
    }
    _forwards.clear();
    await _client?.close();
    _client = null;
  }
}
