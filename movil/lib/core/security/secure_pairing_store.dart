import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecurePairingStore {
  const SecurePairingStore();

  static const _tokenKey = 'helix.mobile.pairing_token';
  static const _pairingsKey = 'helix.mobile.pairings';
  static const _relayUrlKey = 'helix.mobile.relay_url';
  static const _identityKey = 'helix.mobile.identity_key_pem';
  static const _fingerprintKey = 'helix.mobile.host_fingerprint';
  static const _autoConnectKey = 'helix.mobile.auto_connect';

  static const FlutterSecureStorage _storage = FlutterSecureStorage();

  Future<void> save({
    required String token,
    String? relayWssUrl,
    String? identityKeyPem,
    String? hostKeyFingerprint,
    String? transportMode,
    String? sshHost,
    String? sshUser,
    int? sshPort,
    int? remoteWsPort,
  }) async {
    await Future.wait([
      _writeOrDelete(_tokenKey, token),
      _writeOrDelete(_relayUrlKey, relayWssUrl),
      _writeOrDelete(_identityKey, identityKeyPem),
      _writeOrDelete(_fingerprintKey, hostKeyFingerprint),
      _writeOrDelete(_transportModeKey, transportMode),
      _writeOrDelete(_sshHostKey, sshHost),
      _writeOrDelete(_sshUserKey, sshUser),
      _writeOrDelete(_sshPortKey, sshPort?.toString()),
      _writeOrDelete(_remoteWsPortKey, remoteWsPort?.toString()),
      _storage.write(key: _autoConnectKey, value: 'true'),
    ]);
  }

  static const _transportModeKey = 'helix.mobile.transport_mode';
  static const _sshHostKey = 'helix.mobile.ssh_host';
  static const _sshUserKey = 'helix.mobile.ssh_user';
  static const _sshPortKey = 'helix.mobile.ssh_port';
  static const _remoteWsPortKey = 'helix.mobile.remote_ws_port';

  Future<void> _writeOrDelete(String key, String? value) async {
    final normalized = value?.trim();
    if (normalized == null || normalized.isEmpty) {
      await _storage.delete(key: key);
    } else {
      await _storage.write(key: key, value: normalized);
    }
  }

  Future<String?> token() => _storage.read(key: _tokenKey);
  Future<String?> relayWssUrl() => _storage.read(key: _relayUrlKey);
  Future<String?> identityKeyPem() => _storage.read(key: _identityKey);
  Future<String?> hostKeyFingerprint() => _storage.read(key: _fingerprintKey);

  Future<SavedMobilePairing?> load() async {
    final values = await Future.wait<String?>([
      _storage.read(key: _tokenKey),
      _storage.read(key: _transportModeKey),
      _storage.read(key: _relayUrlKey),
      _storage.read(key: _sshHostKey),
      _storage.read(key: _sshUserKey),
      _storage.read(key: _sshPortKey),
      _storage.read(key: _remoteWsPortKey),
      _storage.read(key: _identityKey),
      _storage.read(key: _fingerprintKey),
    ]);
    final token = values[0];
    final relayUrl = values[2];
    final sshHost = values[3];
    if (token == null || token.isEmpty) return null;
    final mode = values[1] ?? (relayUrl != null ? 'relay' : 'sshTunnel');
    if ((mode == 'relay' && (relayUrl == null || relayUrl.isEmpty)) ||
        (mode == 'sshTunnel' &&
            (sshHost == null ||
                sshHost.isEmpty ||
                values[4] == null ||
                values[4]!.isEmpty ||
                values[7] == null ||
                values[8] == null))) {
      return null;
    }

    return SavedMobilePairing(
      token: token,
      transportMode: mode,
      relayWssUrl: relayUrl,
      sshHost: sshHost,
      sshUser: values[4],
      sshPort: int.tryParse(values[5] ?? ''),
      remoteWsPort: int.tryParse(values[6] ?? ''),
      identityKeyPem: values[7],
      hostKeyFingerprint: values[8],
    );
  }

  Future<List<SavedMobilePairing>> loadAll() async {
    final raw = await _storage.read(key: _pairingsKey);
    if (raw != null) {
      final decoded = jsonDecode(raw);
      if (decoded is! List) {
        throw const FormatException('Saved HELIX pairings are invalid.');
      }
      return decoded.map((value) {
        if (value is! Map<String, dynamic>) {
          throw const FormatException('Saved HELIX pairing is invalid.');
        }
        return SavedMobilePairing.fromJson(value);
      }).toList(growable: false);
    }

    final legacy = await load();
    if (legacy == null) return const [];
    final endpoint = legacy.relayWssUrl ?? legacy.sshHost ?? '';
    final migrated = legacy.copyWith(
      sessionId: _sessionIdFor(endpoint),
      name: legacy.relayWssUrl ?? legacy.sshHost ?? 'HELIX Desktop',
    );
    await savePairing(migrated);
    return [migrated];
  }

  Future<void> savePairing(SavedMobilePairing pairing) async {
    final pairings = await _loadAllWithoutMigration();
    final index =
        pairings.indexWhere((item) => item.sessionId == pairing.sessionId);
    if (index == -1) {
      pairings.add(pairing);
    } else {
      pairings[index] = pairing;
    }
    await _storage.write(
      key: _pairingsKey,
      value: jsonEncode(pairings.map((item) => item.toJson()).toList()),
    );
  }

  Future<void> removePairing(String sessionId) async {
    final pairings = await loadAll();
    pairings.removeWhere((item) => item.sessionId == sessionId);
    await _storage.write(
      key: _pairingsKey,
      value: jsonEncode(pairings.map((item) => item.toJson()).toList()),
    );
  }

  Future<List<SavedMobilePairing>> _loadAllWithoutMigration() async {
    final raw = await _storage.read(key: _pairingsKey);
    if (raw == null) return [];
    final decoded = jsonDecode(raw);
    if (decoded is! List) {
      throw const FormatException('Saved HELIX pairings are invalid.');
    }
    return decoded.map((value) {
      if (value is! Map<String, dynamic>) {
        throw const FormatException('Saved HELIX pairing is invalid.');
      }
      return SavedMobilePairing.fromJson(value);
    }).toList();
  }

  static String _sessionIdFor(String value) {
    final segments = Uri.tryParse(value)
        ?.pathSegments
        .where((segment) => segment.isNotEmpty)
        .toList();
    if (segments != null &&
        segments.length >= 3 &&
        segments[0] == 'v1' &&
        segments[1] == 'rooms') {
      return segments[2];
    }
    return 'legacy-${value.hashCode.abs()}';
  }

  Future<bool> autoConnectEnabled() async =>
      await _storage.read(key: _autoConnectKey) != 'false';

  Future<void> setAutoConnectEnabled(bool enabled) =>
      _storage.write(key: _autoConnectKey, value: enabled.toString());

  Future<void> clear() async {
    await Future.wait([
      _storage.delete(key: _tokenKey),
      _storage.delete(key: _pairingsKey),
      _storage.delete(key: _relayUrlKey),
      _storage.delete(key: _identityKey),
      _storage.delete(key: _fingerprintKey),
      _storage.delete(key: _autoConnectKey),
      _storage.delete(key: _transportModeKey),
      _storage.delete(key: _sshHostKey),
      _storage.delete(key: _sshUserKey),
      _storage.delete(key: _sshPortKey),
      _storage.delete(key: _remoteWsPortKey),
    ]);
  }
}

class SavedMobilePairing {
  const SavedMobilePairing({
    this.sessionId = '',
    this.name = 'HELIX Desktop',
    this.deviceId,
    required this.token,
    required this.transportMode,
    this.relayWssUrl,
    this.sshHost,
    this.sshUser,
    this.sshPort,
    this.remoteWsPort,
    this.identityKeyPem,
    this.hostKeyFingerprint,
  });

  final String sessionId;
  final String name;
  final String? deviceId;
  final String token;
  final String transportMode;
  final String? relayWssUrl;
  final String? sshHost;
  final String? sshUser;
  final int? sshPort;
  final int? remoteWsPort;
  final String? identityKeyPem;
  final String? hostKeyFingerprint;

  SavedMobilePairing copyWith({
    String? sessionId,
    String? name,
  }) =>
      SavedMobilePairing(
        sessionId: sessionId ?? this.sessionId,
        name: name ?? this.name,
        deviceId: deviceId,
        token: token,
        transportMode: transportMode,
        relayWssUrl: relayWssUrl,
        sshHost: sshHost,
        sshUser: sshUser,
        sshPort: sshPort,
        remoteWsPort: remoteWsPort,
        identityKeyPem: identityKeyPem,
        hostKeyFingerprint: hostKeyFingerprint,
      );

  Map<String, dynamic> toJson() => {
        'sessionId': sessionId,
        'name': name,
        'deviceId': deviceId,
        'token': token,
        'transportMode': transportMode,
        'relayWssUrl': relayWssUrl,
        'sshHost': sshHost,
        'sshUser': sshUser,
        'sshPort': sshPort,
        'remoteWsPort': remoteWsPort,
        'identityKeyPem': identityKeyPem,
        'hostKeyFingerprint': hostKeyFingerprint,
      };

  factory SavedMobilePairing.fromJson(Map<String, dynamic> json) {
    final sessionId = json['sessionId'];
    final name = json['name'];
    final token = json['token'];
    final transportMode = json['transportMode'];
    if (sessionId is! String ||
        sessionId.isEmpty ||
        name is! String ||
        name.isEmpty ||
        (json['deviceId'] != null &&
            (json['deviceId'] is! String ||
                !RegExp(r'^[A-Za-z0-9_-]{20,64}$')
                    .hasMatch(json['deviceId'] as String))) ||
        token is! String ||
        transportMode is! String ||
        !{'relay', 'sshTunnel'}.contains(transportMode)) {
      throw const FormatException('Saved HELIX pairing is invalid.');
    }
    return SavedMobilePairing(
      sessionId: sessionId,
      name: name,
      deviceId: json['deviceId'] as String?,
      token: token,
      transportMode: transportMode,
      relayWssUrl: json['relayWssUrl'] as String?,
      sshHost: json['sshHost'] as String?,
      sshUser: json['sshUser'] as String?,
      sshPort: json['sshPort'] as int?,
      remoteWsPort: json['remoteWsPort'] as int?,
      identityKeyPem: json['identityKeyPem'] as String?,
      hostKeyFingerprint: json['hostKeyFingerprint'] as String?,
    );
  }
}
