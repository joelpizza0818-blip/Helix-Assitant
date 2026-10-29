import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class MobileBackgroundConnection {
  const MobileBackgroundConnection();

  static const _channel = MethodChannel(
    'dev.helix.assistant.mobile/background_connection',
  );

  Future<bool> start() async {
    if (defaultTargetPlatform != TargetPlatform.android) return true;
    return await _channel.invokeMethod<bool>('start') ?? false;
  }

  Future<void> stop() async {
    if (defaultTargetPlatform == TargetPlatform.android) {
      await _channel.invokeMethod<void>('stop');
    }
  }
}
