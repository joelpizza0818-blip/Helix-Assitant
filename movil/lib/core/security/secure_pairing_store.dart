import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecurePairingStore {
  const SecurePairingStore();

  static const _tokenKey = 'helix.mobile.pairing_token';
  static const _relayUrlKey = 'helix.mobile.relay_url';
  static const _identityKey = 'helix.mobile.identity_key_pem';
  static const _fingerprintKey = 'helix.mobile.host_fingerprint';

  static const FlutterSecureStorage _storage = FlutterSecureStorage();

  Future<void> save({
    required String token,
    String? relayWssUrl,
    String? identityKeyPem,
    String? hostKeyFingerprint,
  }) async {
    await _storage.write(key: _tokenKey, value: token);
    if (relayWssUrl != null && relayWssUrl.trim().isNotEmpty) {
      await _storage.write(key: _relayUrlKey, value: relayWssUrl.trim());
    } else {
      await _storage.delete(key: _relayUrlKey);
    }
    if (identityKeyPem != null && identityKeyPem.trim().isNotEmpty) {
      await _storage.write(key: _identityKey, value: identityKeyPem);
    }
    if (hostKeyFingerprint != null && hostKeyFingerprint.trim().isNotEmpty) {
      await _storage.write(key: _fingerprintKey, value: hostKeyFingerprint);
    }
  }

  Future<String?> token() => _storage.read(key: _tokenKey);
  Future<String?> relayWssUrl() => _storage.read(key: _relayUrlKey);
  Future<String?> identityKeyPem() => _storage.read(key: _identityKey);
  Future<String?> hostKeyFingerprint() => _storage.read(key: _fingerprintKey);

  Future<void> clear() async {
    await Future.wait([
      _storage.delete(key: _tokenKey),
      _storage.delete(key: _relayUrlKey),
      _storage.delete(key: _identityKey),
      _storage.delete(key: _fingerprintKey),
    ]);
  }
}
