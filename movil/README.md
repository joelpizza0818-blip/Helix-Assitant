# HELIX móvil

Aplicación móvil multiplataforma para controlar una instalación de HELIX Desktop de forma remota. Esta carpeta es un workspace aislado para el desarrollo móvil: no reemplaza `apps/desktop`, `apps/desktop-tauri` ni el agente Python.

## Estado de la auditoría

**Estado: Android `mobile-v0.5.0` está publicado con APK firmado universal y variantes por ABI. La disponibilidad de esta versión en el catálogo de la landing debe verificarse por separado; no hay prueba de instalación en dispositivo físico.**

El agente expone un protocolo JSON sobre WebSocket y autentica con `HELIX_WS_TOKEN`. Para un host remoto, el móvil necesita un túnel SSH o un relay autorizado. El flujo existente de pairing temporal sigue disponible; el worktree actual también integra invitaciones QR v2 de cinco minutos, aprobación en Desktop y relay Cloudflare Worker. El Worker debe desplegarse y probarse en un teléfono antes de considerar funcional esa ruta en producción.

## Qué contiene esta carpeta

```text
movil/
├─ README.md
├─ pubspec.yaml                         # Dependencias Flutter/Dart del cliente
├─ analysis_options.yaml
├─ config/
│  ├─ README.md
│  └─ mobile.example.json               # Configuración sin secretos
├─ docs/
│  ├─ arquitectura.md                   # Capas y límites
│  ├─ interfaz.md                       # Sistema de pantallas y UX móvil
│  ├─ protocolo.md                      # Contrato JSON compatible con el agente
│  ├─ websocket.md                      # Sesiones, reconexión y eventos
│  ├─ ssh.md                            # Túnel SSH y emparejamiento
│  ├─ seguridad.md                      # Threat model y almacenamiento seguro
│  ├─ pruebas.md                        # Matriz de verificación
│  ├─ desarrollo.md                     # Cómo arrancar el workspace
│  └─ roadmap.md                        # Secuencia de implementación
├─ lib/
│  ├─ main.dart
│  ├─ app/                               # Shell, tema y navegación
│  ├─ core/                              # Núcleo sin widgets de producto
│  │  ├─ config/
│  │  ├─ models/
│  │  ├─ session/
│  │  └─ transport/
│  └─ features/
│     ├─ chat/
│     └─ connection/
└─ test/                                 # Pruebas de contrato y dominio
```

## Arranque rápido

1. Instalar Flutter estable con soporte Android/iOS/Web/Desktop según el objetivo.
2. Desde esta carpeta ejecutar `flutter pub get`.
3. Copiar `config/mobile.example.json` a una configuración local fuera de Git.
4. Desde Desktop > Toolbox > Vincular móvil genera una invitación; para QR v2, escanéala desde el móvil o usa la alternativa de pegar el JSON. Nunca pegar `HELIX_WS_TOKEN` en el repositorio.
5. Ejecutar `flutter analyze` y `flutter test` antes de conectar una máquina real.

La superficie visual ya incluye chat remoto, modo Voice, drawer, estado de conexión, panel Desktop y composer bloqueado hasta conectar. En targets nativos el botón de conexión abre SSH + forward loopback o Relay WSS y después el WebSocket autenticado del agente. Web solo sirve para previsualizar la interfaz: no puede establecer el handshake autenticado porque el navegador no permite configurar el header `Authorization`; el cliente no envía tokens en query strings.

## Decisiones iniciales

- **Tecnología:** Flutter/Dart multiplatform.
- **Transporte primario de primera fase:** WebSocket autenticado dentro de túnel SSH nativo (`dartssh2`).
- **Transporte alternativo:** relay WebSocket con sesión efímera y autorización explícita.
- **Fuente de verdad del protocolo:** `services/agent/main.py` y `services/agent/core/desktop_bridge.py`.
- **Límite:** el móvil controla y observa; no ejecuta herramientas del sistema local del teléfono.
- **Seguridad:** claves SSH y tokens de pairing en almacenamiento seguro del sistema, nunca en preferencias planas ni logs.

## Interfaz disponible en esta iteración

- **Chat:** estado vacío orientado a conectar Desktop, burbujas de conversación y composer deshabilitado cuando no hay sesión.
- **Desktop:** resumen del transporte, destino loopback y acción de conexión/desconexión.
- **Estado global:** píldora `Offline`, `Conectando` o `Conectado` en la cabecera.
- **Vinculación:** pairing temporal SSH/Relay; el worktree añade escaneo QR o importación manual de invitaciones v2 y validación de expiración antes de solicitar aprobación en Desktop.
- **Identidad visual:** fondo carbón, superficies discretas, naranja HELIX como acento y navegación táctil nativa de Flutter.

## Límites conocidos

- El agente actual solo escucha en loopback; el relay SSH requiere que el host remoto tenga SSH habilitado.
- Android `mobile-v0.5.0` está publicado como release estable firmada, con APK universal y variantes `armeabi-v7a`, `arm64-v8a` y `x86_64`, cada una con SHA-256. No hay prueba de instalación en dispositivo físico.
- CI verificó firmas y checksums de los cuatro APK. No hay IPA iOS publicado ni evidencia de instalación física.
- La landing ya no se debe describir como seleccionada en `0.5.0` hasta confirmar que su catálogo publica esta versión. El release de GitHub incluye el APK ARM64 y el universal con sus checksums.
- El build Android local no se verificó: el SDK configurado tiene metadatos inconsistentes para Android 35. El build firmado y la medición se confirmaron en CI.
- Web solo sirve para previsualizar la interfaz y no puede completar el handshake autenticado.

Consultar `docs/roadmap.md` antes de ampliar el alcance.
