# Arquitectura Mobile — HELIX

## Flujo de conexión

```
[Mobile App Flutter]
        │
        │ 1. Usuario pega token de invitación
        ▼
[_ConnectionSheet] → valida campos → _submit()
        │
        │ 2. MobileConnection.connect(config, token)
        ▼
[WebSocketHelixTransport]
        │
        │ 3a. Modo RELAY (preferido en producción)
        │    connectAuthenticatedWebSocket(relayWssUrl, token)
        │    Headers: Authorization: Bearer <token>, X-HELIX-Role: mobile
        │    await channel.ready [timeout: 12s]
        │
        │ 3b. Modo SSH (fallback local)
        │    SshTunnelManager.open(desktop) → localPort
        │    connectAuthenticatedWebSocket(ws://127.0.0.1:<localPort>, token)
        ▼
[RelayServer Python]  ←────────────────── [Desktop Electron]
        │                                      │
        │ join room[token]                     │ join room[token] as "desktop"
        │ role: "mobile"                       │ X-HELIX-Pairing-Expires: <unix>
        │                                      │
        └──────── mensajes bidireccionales ────┘
```

## Protocolo de mensajes

```json
{
  "type": "USER_TEXT",
  "requestId": "optional-for-request-response",
  "payload": {
    "text": "Resume mi sesión",
    "conversation_id": "mobile-session",
    "conversation_history": []
  }
}
```

## Archivos clave

| Archivo | Responsabilidad |
|---------|----------------|
| `chat_screen.dart` | UI principal: chat, voice, conexión |
| `mobile_connection.dart` | Orquesta transporte (relay vs SSH) |
| `helix_session.dart` | Request-response sobre el transporte |
| `websocket_transport.dart` | WebSocket con auth Bearer |
| `mobile_config.dart` | Tipos de configuración |
| `secure_pairing_store.dart` | Almacenamiento seguro del token/clave |

## URL del relay en producción

```
wss://desktop-7hrsa16.taild4cce1.ts.net
```
Proveedor: Tailscale Funnel  
Generado: 2026-10-23

## Consideraciones de seguridad

- El token es de corta duración (`X-HELIX-Pairing-Expires`)
- El relay NO ejecuta comandos, solo retransmite
- La clave SSH se guarda en `flutter_secure_storage` (Keychain iOS / Keystore Android)
- El fingerprint SSH obligatorio evita MITM
