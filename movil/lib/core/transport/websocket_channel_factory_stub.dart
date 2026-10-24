import 'package:web_socket_channel/web_socket_channel.dart';

WebSocketChannel connectAuthenticatedWebSocket(Uri uri, String token) {
  final params = Map<String, String>.from(uri.queryParameters)..['access_token'] = token;
  return WebSocketChannel.connect(uri.replace(queryParameters: params));
}
