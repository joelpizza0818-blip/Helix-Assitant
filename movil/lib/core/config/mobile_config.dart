enum MobileTransportMode { sshTunnel, relay }

class MobileConfig {
  const MobileConfig({
    required this.mode,
    required this.desktop,
    this.relayWssUrl,
    this.connectTimeout = const Duration(seconds: 10),
    this.requestTimeout = const Duration(seconds: 30),
  });

  final MobileTransportMode mode;
  final DesktopConfig desktop;
  final String? relayWssUrl;
  final Duration connectTimeout;
  final Duration requestTimeout;
}

class DesktopConfig {
  const DesktopConfig({
    required this.host,
    required this.sshPort,
    required this.sshUser,
    required this.remoteWsPort,
    required this.identityKeyRef,
    required this.wsTokenRef,
    this.identityKeyPem,
    this.identityPassphrase,
    this.hostKeyFingerprint,
    this.remoteWsHost = '127.0.0.1',
  });

  final String host;
  final int sshPort;
  final String sshUser;
  final String remoteWsHost;
  final int remoteWsPort;
  final String identityKeyRef;
  final String wsTokenRef;
  final String? identityKeyPem;
  final String? identityPassphrase;
  final String? hostKeyFingerprint;
}
