# Seguridad y privacidad

## Amenazas

- Desktop expuesto accidentalmente en una red.
- Robo del teléfono o extracción del almacenamiento local.
- Host SSH suplantado.
- Repetición de `CONFIRMATION_GRANTED` o `TASK_CANCEL`.
- Logs móviles que contienen prompts, respuestas o tokens.
- Reconexión que duplica una acción sensible.

## Controles obligatorios

- No abrir `8765` públicamente; usar SSH o relay WSS.
- El relay de `services/relay` solo debe exponerse detrás de TLS (`wss://`) y
  rate limiting del proveedor de infraestructura.
- Token WebSocket en almacenamiento seguro y memoria volátil cuando sea posible.
- Host-key pinning y validación de fingerprint.
- Pairing con expiración, revocación y scopes.
- IDs de sesión y `request_id` aleatorios; deduplicación de eventos.
- Redacción de payloads en logs; nunca registrar Authorization, prompts completos o adjuntos.
- Confirmación humana en el móvil para toda acción marcada sensible.
- Biometría opcional antes de abrir el canal o confirmar una acción de alto riesgo.
- Cifrado del almacenamiento de borradores y borrado al cerrar sesión.

## No hacer

- No incrustar API keys de proveedores en la app.
- No compartir `HELIX_WS_TOKEN` por QR permanente, URL pública o archivo de preferencias.
- No usar `accept all host keys`.
- No reintentar automáticamente una ejecución de terminal o una escritura externa.
