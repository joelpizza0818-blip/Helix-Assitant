# WebSocket y sesiones

## Estado actual del backend

El agente escucha en `ws://127.0.0.1:8765` y valida `Authorization: Bearer <HELIX_WS_TOKEN>` durante el handshake. Ese canal es local; no debe publicarse directamente.

## Sesión móvil

```text
Flutter ── SSH local forward ──> Desktop 127.0.0.1:8765
Flutter ── WebSocket ws://127.0.0.1:<local-port> + Bearer token
```

En relay:

```text
Flutter ── WSS ──> Relay autenticado ── canal seguro ──> Desktop connector ──> Agent WS local
```

## Reglas de implementación

- Usar `wss` en relay; `ws` solo para el extremo local del túnel.
- Aplicar timeout de handshake y límite de tamaño del frame.
- Validar JSON como objeto antes de decodificar el envelope.
- No reconectar acciones mutantes automáticamente.
- Separar timeout de conexión, timeout de request y timeout de tarea.
- Cerrar el stream al cerrar sesión, cambiar de destino o revocar pairing.
