# Configuración móvil

Los archivos de esta carpeta describen destinos, no secretos. La aplicación debe importar la configuración desde un flujo de pairing o desde almacenamiento seguro del sistema.

## Modos soportados

- `ssh_tunnel`: el móvil abre un túnel local hacia `127.0.0.1:8765` en el desktop y luego conecta WebSocket.
- `relay`: el móvil conecta a un endpoint WSS gestionado, usando una sesión efímera asociada a un desktop emparejado.

El puerto WebSocket del agente no debe exponerse directamente a Internet. `remote_ws_port` es el puerto visto por SSH en el host remoto, no una invitación a abrirlo en el router.
