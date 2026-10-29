import 'dart:convert';

class HelixMessage {
  const HelixMessage({required this.type, this.requestId, this.payload = const {}, this.error});

  final String type;
  final String? requestId;
  final Map<String, dynamic> payload;
  final String? error;

  factory HelixMessage.fromJson(String raw) {
    final value = jsonDecode(raw);
    if (value is! Map<String, dynamic> || value['type'] is! String) {
      throw const FormatException('HELIX message must be an object with a string type');
    }
    final payload = value['payload'];
    if (payload != null &&
        payload is! Map<String, dynamic> &&
        payload is! List) {
      throw const FormatException('HELIX payload must be an object');
    }
    return HelixMessage(
      type: value['type'] as String,
      requestId: value['request_id'] as String?,
      payload: payload == null
          ? const {}
          : payload is List
              ? {'items': payload}
              : Map<String, dynamic>.from(payload as Map),
      error: value['error'] as String?,
    );
  }

  String toJson() => jsonEncode({
        'type': type,
        if (requestId != null) 'request_id': requestId,
        'payload': payload,
      });
}
