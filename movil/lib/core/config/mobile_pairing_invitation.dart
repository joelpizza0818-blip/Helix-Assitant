import 'dart:convert';

class MobilePairingInvitation {
  const MobilePairingInvitation({
    required this.relayWssUrl,
    required this.token,
    required this.expiresAt,
  });

  final String relayWssUrl;
  final String token;
  final DateTime expiresAt;

  static MobilePairingInvitation decode(String raw, {DateTime? now}) {
    final decoded = jsonDecode(raw);
    if (decoded is! Map<String, dynamic> ||
        decoded['version'] != 2 ||
        decoded['requiresDeviceApproval'] != true) {
      throw const FormatException('Unsupported HELIX pairing invitation.');
    }

    final token = decoded['token'];
    final expiresAtValue = decoded['expiresAt'];
    final relayValue = decoded['relayWssUrl'];
    final hostValue = decoded['host'];
    if (token is! String ||
        !RegExp(r'^[A-Za-z0-9_-]{40,128}$').hasMatch(token) ||
        expiresAtValue is! String ||
        relayValue is! String ||
        hostValue != relayValue) {
      throw const FormatException('HELIX pairing invitation is incomplete.');
    }

    final expiresAt = DateTime.tryParse(expiresAtValue);
    if (expiresAt == null || !expiresAt.isAfter(now ?? DateTime.now())) {
      throw const FormatException('HELIX pairing invitation has expired.');
    }

    final relay = Uri.tryParse(relayValue);
    final roomSocketPath = relay == null
        ? null
        : RegExp(r'^/v1/rooms/[A-Za-z0-9_-]{20,64}/socket$')
            .hasMatch(relay.path);
    if (relay == null ||
        relay.scheme != 'wss' ||
        relay.host.isEmpty ||
        relay.userInfo.isNotEmpty ||
        relay.hasQuery ||
        relay.hasFragment ||
        roomSocketPath != true) {
      throw const FormatException('HELIX pairing relay URL is invalid.');
    }

    return MobilePairingInvitation(
      relayWssUrl: relayValue,
      token: token,
      expiresAt: expiresAt.toUtc(),
    );
  }
}
