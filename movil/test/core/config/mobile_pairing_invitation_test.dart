import 'package:flutter_test/flutter_test.dart';
import 'package:helix_mobile/core/config/mobile_pairing_invitation.dart';

void main() {
  final now = DateTime.utc(2026, 10, 28);
  final token = List.filled(43, 'A').join();
  const relayUrl =
      'wss://helix.example/v1/rooms/abcdefghijklmnopqrstuvwx/socket';

  String invitation({
    String? url,
    String? expiry,
    String? tokenValue,
    bool requiresApproval = true,
  }) {
    final relay = url ?? relayUrl;
    return '''
      {
        "version": 2,
        "host": "$relay",
        "sshPort": 22,
        "remoteWsPort": 0,
        "token": "${tokenValue ?? token}",
        "expiresAt": "${expiry ?? now.add(const Duration(minutes: 5)).toIso8601String()}",
        "relayWssUrl": "$relay",
        "requiresDeviceApproval": $requiresApproval
      }
    ''';
  }

  test('accepts a valid future Worker invitation', () {
    final result = MobilePairingInvitation.decode(invitation(), now: now);

    expect(result.relayWssUrl, relayUrl);
    expect(result.token, token);
    expect(result.expiresAt, now.add(const Duration(minutes: 5)));
  });

  test('rejects expired invitations', () {
    expect(
      () => MobilePairingInvitation.decode(
        invitation(expiry: now.toIso8601String()),
        now: now,
      ),
      throwsFormatException,
    );
  });

  test('rejects non-TLS or non-Worker socket URLs', () {
    for (final url in [
      relayUrl.replaceFirst('wss://', 'ws://'),
      'wss://helix.example/v1/rooms/abcdefghijklmnopqrstuvwx/other',
      'wss://user@helix.example/v1/rooms/abcdefghijklmnopqrstuvwx/socket',
      '$relayUrl?token=leak',
    ]) {
      expect(
        () => MobilePairingInvitation.decode(invitation(url: url), now: now),
        throwsFormatException,
      );
    }
  });

  test('rejects invitations without explicit device approval', () {
    expect(
      () => MobilePairingInvitation.decode(
        invitation(requiresApproval: false),
        now: now,
      ),
      throwsFormatException,
    );
  });
}
