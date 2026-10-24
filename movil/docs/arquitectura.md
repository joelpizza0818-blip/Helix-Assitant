# Arquitectura móvil

## Capas

```text
Flutter UI
  └─ feature controllers / estado de pantalla
      └─ HelixSession
          ├─ Transport (WebSocket o relay)
          ├─ SshTunnelManager (solo para ssh_tunnel)
          ├─ ProtocolCodec (envelope JSON)
          └─ SecureCredentialStore (token/llave fuera de logs)
```

La UI no conoce sockets, SSH ni headers de autenticación. `HelixSession` expone estados (`disconnected`, `connecting`, `connected`, `reconnecting`, `failed`) y streams de eventos tipados.

## Responsabilidades

| Área | Responsabilidad | No debe hacer |
|---|---|---|
| `features/` | Pantallas, interacción, accesibilidad y estados de presentación | Leer tokens o construir JSON crudo |
| `core/session` | Correlación de requests, reconexión, cancelación y estado | Ejecutar comandos del sistema móvil |
| `core/transport` | Conectar, enviar, recibir y cerrar | Decidir permisos de producto |
| `core/models` | Modelar envelopes, tareas, mensajes y confirmaciones | Persistir credenciales |
| SSH/relay | Crear el canal remoto autorizado | Saltarse pairing o validar host de forma débil |

## Flujo de envío

1. Usuario escribe texto.
2. `ChatController` crea/recupera `conversation_id` y limita el historial enviado.
3. `HelixSession.sendUserText()` valida texto, adjuntos y tamaño.
4. El transporte envía `{type: USER_TEXT, request_id: null, payload: ...}`.
5. El agente publica `agent_message`, `task_update`, `status_update` y confirmaciones.
6. La UI actualiza el timeline; no asume que el orden de eventos sea perfecto.

## Estado y reconexión

La sesión debe mantener un único consumidor del socket. Al perderse la conexión:

- congelar el envío con estado visible;
- conservar el borrador local de texto;
- reintentar con backoff 1, 2, 4, 8, 16 y 30 segundos;
- crear un nuevo handshake y no reutilizar un socket muerto;
- deduplicar eventos por `event_id` cuando el relay lo provea;
- nunca repetir automáticamente una acción sensible.
