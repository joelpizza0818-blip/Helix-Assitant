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
- Para el MVP, la confirmación humana de acciones sensibles ocurre en Desktop; no aceptar confirmaciones administrativas desde el rol móvil.
- Biometría opcional antes de abrir el canal o confirmar una acción de alto riesgo.
- Cifrado del almacenamiento de borradores y borrado al cerrar sesión.

## Alcance móvil inicial — diseño aprobado, no implementado

| Operación | Política inicial |
|---|---|
| Enviar texto al agente | Permitido; las herramientas solicitadas por el agente siguen sujetas a la política Desktop |
| Consultar estado limitado y eventos de conversación | Permitido mediante contrato read-only acotado |
| Cancelar tarea iniciada en la sesión móvil | Permitido si se implementa vinculación con esa sesión; cancelar todas las tareas queda denegado |
| Ajustes, proveedores/modelos, claves, MCP/plugins/capacidades, memoria y datos de administración | Denegado para rol móvil |
| Ejecutar herramientas directamente o elevar privilegios | Denegado; solicitudes de chat no saltan el policy engine |
| Conceder/rechazar confirmaciones o resolver capacidades | Denegado desde móvil en el MVP; pedir confirmación en Desktop |

El permiso debe comprobarse en el agente/puente contra credencial, rol y scopes de dispositivo. La interfaz Flutter no es una frontera de seguridad. El protocolo actual todavía no asocia scopes por dispositivo y no cumple esta matriz.

## Relay Quick Tunnel — piloto inseguro para datos sensibles

El relay actual reutiliza el mismo token de invitación para Desktop y móvil, y acepta el rol declarado en un header; no autentica una identidad Desktop separada ni aplica scopes por dispositivo. Cloudflare Quick Tunnel solo aporta un transporte TLS temporal, no corrige esas limitaciones. Usarlo únicamente en pruebas con dispositivos propios y datos no sensibles; no compartir invitación ni endpoint.

## No hacer

- No incrustar API keys de proveedores en la app.
- No compartir `HELIX_WS_TOKEN` por QR permanente, URL pública o archivo de preferencias.
- No mover tokens WebSocket a query strings para sortear la limitación de headers de Flutter Web; el preview web debe fallar explícitamente y no iniciar una conexión autenticada.
- No usar `accept all host keys`.
- No reintentar automáticamente una ejecución de terminal o una escritura externa.
