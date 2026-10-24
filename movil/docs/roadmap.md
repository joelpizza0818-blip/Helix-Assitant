# Roadmap móvil

## Fase 0 — contrato y gobernanza (actual)

- [x] Separar el trabajo en `movil/`.
- [x] Auditar WebSocket local, eventos, límites y autenticación existente.
- [x] Definir capas Flutter, configuración y riesgos SSH/relay.
- [x] Decidir el primer pairing temporal con el backend; los scopes por dispositivo quedan para la fase relay.

## Fase 1 — shell Flutter y conexión simulada

- [x] Generar `flutter create .` dentro de `movil/` sin sobrescribir estos documentos.
- [x] Implementar tema HELIX, navegación y estados vacíos.
- [x] Implementar `ProtocolCodec`, `HelixSession` y fake transport.
- [x] Cubrir mensajes, confirmaciones, tareas y reconexión con tests.

## Fase 2 — WebSocket por SSH

- [x] Implementar `SshTunnelManager` detrás de una interfaz.
- [x] Integrar librería SSH mantenida y host-key pinning.
- [x] Crear pairing temporal rotatorio en Desktop.
- Probar Android/iOS en red privada y con caída de Wi-Fi.

## Fase 3 — relay seguro

- [x] Diseñar servicio WSS separado; no reutilizar el WebSocket loopback directamente.
- [x] Implementar puente Desktop ↔ Relay ↔ Mobile con pairing temporal.
- Sesiones efímeras y rotación están implementadas; scopes por dispositivo y rate limiting quedan pendientes.
- [x] Añadir connector en Desktop y pruebas de interoperabilidad.

## Fase 4 — publicación

- Builds firmadas Android/iOS.
- Política de privacidad y telemetría mínima.
- Pruebas en dispositivos físicos, background, notificaciones y actualización.
- Evidencia independiente antes de marcar soporte móvil como publicado.
