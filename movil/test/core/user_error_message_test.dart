import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:helix_mobile/core/errors/user_error_message.dart';

void main() {
  test('maps network failures to useful guidance', () {
    expect(
      userFacingErrorMessage(
        const SocketException('internalTransport.connect at /private/path'),
        fallback: 'Fallback',
      ),
      contains('Comprueba la conexión'),
    );
  });

  test('does not expose raw exception details', () {
    const fallback = 'No se pudo completar la acción. Inténtalo de nuevo.';
    final message = userFacingErrorMessage(
      StateError('internalHandler.run failed at /private/path'),
      fallback: fallback,
    );

    expect(message, fallback);
    expect(message, isNot(contains('internalHandler')));
    expect(message, isNot(contains('/private/path')));
  });
}
