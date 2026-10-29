import 'dart:async';
import 'dart:convert';

import 'websocket_channel_factory.dart';

class WorkerRelayPairingClient {
  WorkerRelayPairingClient({
    required this.uri,
    required this.invitationToken,
  });

  final Uri uri;
  final String invitationToken;

  Future<WorkerRelayCredentials> pair() async {
    final channel = connectAuthenticatedWebSocket(uri, invitationToken);
    StreamSubscription<dynamic>? subscription;
    try {
      await channel.ready.timeout(
        const Duration(seconds: 12),
        onTimeout: () => throw TimeoutException(
            'HELIX relay did not respond within 12 seconds'),
      );
      final result = Completer<WorkerRelayCredentials>();
      subscription = channel.stream.listen(
        (value) {
          if (value is! String) {
            if (!result.isCompleted) {
              result.completeError(const FormatException(
                  'Relay pairing response must be text.'));
            }
            return;
          }
          try {
            final decoded = jsonDecode(value);
            if (decoded is! Map<String, dynamic> ||
                decoded['type'] is! String) {
              throw const FormatException('Relay pairing response is invalid.');
            }
            if (decoded['type'] == 'HELIX_PAIRING_PENDING') return;
            if (decoded['type'] == 'HELIX_PAIRING_REJECTED') {
              throw StateError('The Desktop rejected this pairing request.');
            }
            if (decoded['type'] != 'HELIX_PAIRING_APPROVED') {
              throw const FormatException('Unexpected relay pairing response.');
            }
            final payload = decoded['payload'];
            if (payload is! Map<String, dynamic>) {
              throw const FormatException(
                  'Relay pairing credentials are invalid.');
            }
            final deviceId = payload['device_id'];
            final deviceToken = payload['device_token'];
            if (deviceId is! String ||
                !RegExp(r'^[A-Za-z0-9_-]{20,64}$').hasMatch(deviceId) ||
                deviceToken is! String ||
                !RegExp(r'^[A-Za-z0-9_-]{40,128}$').hasMatch(deviceToken)) {
              throw const FormatException(
                  'Relay pairing credentials are invalid.');
            }
            if (!result.isCompleted) {
              result.complete(WorkerRelayCredentials(
                deviceId: deviceId,
                deviceToken: deviceToken,
              ));
            }
          } on Object catch (error, stackTrace) {
            if (!result.isCompleted) result.completeError(error, stackTrace);
          }
        },
        onError: (Object error, StackTrace stackTrace) {
          if (!result.isCompleted) result.completeError(error, stackTrace);
        },
        onDone: () {
          if (!result.isCompleted) {
            result.completeError(
                StateError('The pairing connection closed before approval.'));
          }
        },
        cancelOnError: true,
      );
      return await result.future.timeout(
        const Duration(minutes: 5),
        onTimeout: () => throw TimeoutException(
            'Desktop approval timed out after five minutes.'),
      );
    } finally {
      await subscription?.cancel();
      await channel.sink.close();
    }
  }
}

class WorkerRelayCredentials {
  const WorkerRelayCredentials({
    required this.deviceId,
    required this.deviceToken,
  });

  final String deviceId;
  final String deviceToken;
}
