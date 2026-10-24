import '../config/mobile_config.dart';

abstract interface class SshTunnelManager {
  Future<int> open(DesktopConfig config, {required int localPort});
  Future<void> close();
}

class SshTunnelManagerImpl implements SshTunnelManager {
  @override
  Future<int> open(DesktopConfig config, {required int localPort}) =>
      throw UnsupportedError('SSH port forwarding requires a native Flutter target.');

  @override
  Future<void> close() async {}
}
