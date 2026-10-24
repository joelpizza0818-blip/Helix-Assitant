import '../models/protocol_message.dart';

enum TransportState { disconnected, connecting, connected, reconnecting, failed }

abstract interface class HelixTransport {
  Stream<HelixMessage> get messages;
  Stream<TransportState> get states;
  Future<void> connect();
  Future<void> send(HelixMessage message);
  Future<void> close();
}
