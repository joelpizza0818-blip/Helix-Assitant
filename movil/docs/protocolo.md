# Contrato JSON del agente

El contrato se deriva de `services/agent/main.py` y `services/agent/core/desktop_bridge.py`.

## Envelope

```json
{
  "type": "GET_TASKS",
  "request_id": "uuid-v4",
  "payload": {}
}
```

Las respuestas correlacionadas usan `request_id` y contienen `payload` o `error`. Los eventos de servidor no requieren `request_id`:

```json
{"type":"agent_message","payload":{"text":"..."}}
```

## Requests disponibles inicialmente

- `GET_TASKS`
- `GET_PROVIDERS`
- `GET_MODELS`
- `GET_SETTINGS`
- `GET_CAPABILITIES`
- `SAVE_SETTINGS`
- `GET_MEMORY_STATUS`
- `CLEAR_MEMORY`
- `GET_SKILLS`
- `GET_MCP_SERVERS`
- `VALIDATE_KEY`

## Eventos de control

- `USER_TEXT`: requiere `text` o adjuntos; admite `conversation_id` y `conversation_history`.
- `TASK_CANCEL`: requiere `task_id`.
- `TASK_CANCEL_ALL`.
- `CONFIRMATION_GRANTED` / `CONFIRMATION_REJECTED`.

El agente limita a 10 adjuntos y 8 MB totales. El móvil debe validar antes para no enviar payloads que el servidor rechazará.

## Eventos recibidos

`task_update`, `agent_message`, `status_update`, `fallback_event`, `error`, `provider_update`, `confirmation_request`, `confirmation_resolved`, `agent_update`, `react_step`, `skill_update`, `capability-required`, `voice_capture_started` y `voice_capture_stopped`.

El cliente debe tratar eventos desconocidos como `UnknownEvent` y registrar solo el tipo y tamaño, no el contenido sensible.
