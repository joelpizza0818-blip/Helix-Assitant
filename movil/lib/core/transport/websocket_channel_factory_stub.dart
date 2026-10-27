import 'package:web_socket_channel/web_socket_channel.dart';

WebSocketChannel connectAuthenticatedWebSocket(Uri uri, String token) =>
    throw UnsupportedError(
      'Authenticated HELIX connections require a native Flutter target.',
    );
