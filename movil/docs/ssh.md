# Transporte SSH

## Diseño aprobado para la primera fase

SSH no reemplaza el protocolo del agente: solo crea el canal cifrado hacia el `127.0.0.1` del desktop.

```text
local mobile port 18765
  └─ SSH -L 18765:127.0.0.1:8765 user@desktop
       └─ HELIX agent WebSocket en desktop
```

## Configuración requerida

- host/IP o nombre privado del desktop;
- puerto SSH y usuario no administrador;
- clave privada generada/importada en almacenamiento seguro del móvil;
- huella de host fijada durante pairing (no aceptar cualquier host key);
- puerto local efímero para el forward;
- referencia segura al token WebSocket, nunca el token en JSON exportable.

## Implementación Flutter

La API de `SshTunnelManager` debe abstraer la librería concreta (`dartssh2` u otra mantenida) y devolver solo el puerto local conectado. La UI no debe depender de tipos de la librería SSH.

`lib/core/transport/ssh_tunnel_io.dart` implementa el forward nativo con
`dartssh2`: autentica con PEM en memoria, fija la huella cuando se configura,
abre un listener loopback efímero y puentea cada socket hacia
`remoteWsHost:remoteWsPort`. La variante web falla explícitamente porque no
puede abrir TCP nativo.

Pendiente para producción: soporte de background, almacenamiento seguro con
biometría y pruebas con un OpenSSH real en Android/iOS. La generación y
validación del token temporal de pairing ya está implementada en Desktop y el
agente.

## Pairing recomendado

1. Desktop crea una invitación temporal rotatoria con expiración de 30 minutos.
2. Móvil escanea QR que contiene endpoint, fingerprint y referencia de pairing, no una clave privada.
3. Usuario confirma la huella en ambos dispositivos.
4. Desktop registra la clave pública del móvil con permisos limitados.
5. Se emite un token de sesión efímero para WebSocket.
6. Revocar pairing invalida claves y tokens posteriores.
