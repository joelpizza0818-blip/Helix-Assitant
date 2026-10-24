# Auditoría de preparación móvil

Fecha: 2026-10-23

## Hallazgos verificados

1. El agente Python ya tiene un protocolo JSON bidireccional sobre WebSocket.
   Las peticiones correlacionadas usan `request_id`; los eventos salientes usan
   `type` y `payload`.
2. `USER_TEXT` acepta texto, `conversation_id`, historial y adjuntos. El
   backend limita a 10 adjuntos y 8 MB totales.
3. Existen requests para tareas, settings, modelos, proveedores, memoria,
   skills, MCP y capacidades.
4. Existen eventos para mensajes, tareas, estado, fallbacks, errores,
   confirmaciones, subagentes y pasos ReAct.
5. La autenticación actual genera/usa `HELIX_WS_TOKEN` y el agente escucha en
   `127.0.0.1`. Esto es adecuado para Desktop local, no es un endpoint móvil
   remoto por sí mismo.
6. La documentación del vault ya identifica como pendiente el contrato de
   control remoto, autenticación, relay, permisos y límites offline.

## Estado de esta iteración

- La shell visual Flutter usa el mismo fondo carbón, acento naranja, estados y
  marca pixelada de Desktop/Landing.
- `WebSocketHelixTransport` usa `Authorization: Bearer` en targets nativos y
  conserva el contrato JSON correlacionado del agente.
- `SshTunnelManagerImpl` ya abre SSH nativo con `dartssh2`, valida la huella
  cuando se proporciona y sirve un forward loopback para el WebSocket.
- La UI ya recoge host, usuario, clave PEM, huella SSH y token, y envía
  `USER_TEXT` al Desktop conectado. Token, PEM y huella se guardan mediante
  `flutter_secure_storage` una vez que la conexión se establece.
- Toolbox > Vincular móvil genera un token adicional con expiración de 30
  minutos. El agente lo valida desde `HELIX_WS_PAIRING_FILE`; no reemplaza el
  token interno del Desktop y se revoca al cerrar la aplicación.

## Gaps que bloquean un MVP remoto publicado

- El relay ya está implementado en `services/relay`; todavía falta desplegarlo
  detrás de TLS y configurar `HELIX_MOBILE_RELAY_WSS_URL` en la instalación.
- Falta registro de dispositivos y emisión/revocación con scopes por dispositivo.
- El token de pairing actual tiene expiración y rotación, pero no tiene todavía
  permisos diferenciados de solo lectura/ejecución.
- No hay política de background, notificaciones, biometría o borrado de
  credenciales para Android/iOS.
- No hay pruebas E2E móvil → desktop → agente ni un APK firmado publicado.

## Dictamen

La carpeta `movil/` ya contiene una shell funcional, transporte WebSocket real
y forward SSH nativo. No se considera producción remota hasta completar
pairing, almacenamiento seguro, E2E, firma y publicación del paquete móvil.
