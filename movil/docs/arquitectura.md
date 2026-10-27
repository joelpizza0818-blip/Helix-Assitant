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

## Pairing por QR — diseño aprobado, no implementado

El objetivo de producto es QR efímero con alternativa manual:

1. Desktop crea invitación de un solo uso que vence en 5 minutos y muestra el QR/código.
2. La invitación solo contiene versión, endpoint WSS y secreto temporal; nunca incluye el token maestro del agente, API keys ni claves privadas.
3. Escanear crea una solicitud pendiente; Desktop muestra y confirma antes de vincular.
4. Después de aceptar, móvil recibe credencial única por dispositivo y la guarda en almacenamiento seguro.
5. Desktop lista y revoca dispositivos individualmente; revocar cierra la sesión activa y bloquea reconexiones.

El checkout actual solo genera un token temporal de 30 minutos y permite copiar JSON. No hay escáner QR, flujo de aprobación ni credenciales/scopes por dispositivo. No tratar este diseño como funcionalidad entregada.
