import 'dart:async';
import 'dart:io';

String userFacingErrorMessage(Object error, {required String fallback}) {
  if (error is TimeoutException) {
    return 'La operación tardó demasiado. Comprueba tu conexión e inténtalo de nuevo.';
  }
  if (error is SocketException) {
    return 'No se pudo conectar con el Desktop o el servicio. Comprueba la conexión e inténtalo de nuevo.';
  }

  final detail = error.toString().toLowerCase();
  if (detail.contains('timeout') || detail.contains('timed out')) {
    return 'La operación tardó demasiado. Comprueba tu conexión e inténtalo de nuevo.';
  }
  if (detail.contains('socketexception') ||
      detail.contains('connection refused') ||
      detail.contains('network is unreachable')) {
    return 'No se pudo conectar con el Desktop o el servicio. Comprueba la conexión e inténtalo de nuevo.';
  }
  if (detail.contains('unauthorized') || detail.contains('authentication failed')) {
    return 'No se pudo verificar el acceso. Vuelve a vincular el Desktop e inténtalo de nuevo.';
  }

  return fallback;
}
