# Interfaz móvil

La interfaz móvil no es una copia reducida de Toolbox. Es un control remoto de baja densidad, orientado a conversación y estado.

## Navegación

- **Chat:** conversación, respuesta incremental, adjuntos y cancelación.
- **Actividad:** tareas en curso, subagentes y duración.
- **Confirmaciones:** acciones sensibles pendientes; prioridad alta, explicación clara y botones separados.
- **Conexión:** desktop seleccionado, transporte, latencia, último handshake y reconexión.
- **Ajustes:** preferencias móviles, notificaciones y dispositivos emparejados.

## Principios visuales HELIX

- fondo oscuro sobrio, blanco de logo y naranja para acciones/estado activo;
- controles grandes para uso táctil y targets mínimos de 44dp;
- una acción primaria por pantalla;
- estados de conexión siempre visibles, nunca solo por color;
- soporte de texto escalado, lector de pantalla, contraste y reduced motion;
- no mostrar tokens, rutas locales ni datos internos del agente en la UI.

## Pantallas mínimas del MVP

1. **Pairing:** escanear código o introducir datos de un destino ya autorizado.
2. **Connection card:** conectar/desconectar y diagnosticar SSH/WebSocket.
3. **Chat:** enviar texto, ver respuesta, cancelar tarea.
4. **Confirmation sheet:** confirmar o rechazar acciones remotas con contexto.
5. **Activity:** estados `queued`, `running`, `waiting_confirmation`, `completed`, `failed`, `cancelled`.

## No incluido en MVP

Control directo de cámara/micrófono del desktop, edición completa del Toolbox, instalación de capability packs desde móvil y administración de releases.
