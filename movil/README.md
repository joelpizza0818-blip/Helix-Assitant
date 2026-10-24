# HELIX móvil

Aplicación móvil multiplataforma para controlar una instalación de HELIX Desktop de forma remota. Esta carpeta es un workspace aislado para el desarrollo móvil: no reemplaza `apps/desktop`, `apps/desktop-tauri` ni el agente Python.

## Estado de la auditoría

**Estado: shell visual, pairing temporal, Relay local y transportes nativos implementados; despliegue TLS y publicación firmada todavía pendientes.**

La auditoría del repositorio confirma que el agente ya expone un protocolo JSON sobre WebSocket, pero actualmente está ligado a `127.0.0.1` y autentica con `HELIX_WS_TOKEN`. Por eso el móvil no debe intentar conectarse directamente al puerto local de una máquina remota: necesita primero un túnel SSH o un relay autorizado. Desktop genera desde Toolbox una invitación separada, con expiración de 30 minutos, que el agente valida además del token interno.

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
4. Desde Desktop > Toolbox > Vincular móvil genera una invitación; nunca pegar `HELIX_WS_TOKEN` en el repositorio.
5. Ejecutar `flutter analyze` y `flutter test` antes de conectar una máquina real.

La superficie visual ya incluye chat remoto, modo Voice, drawer, estado de conexión, panel Desktop y composer bloqueado hasta conectar. En targets nativos el botón de conexión abre SSH + forward loopback o Relay WSS y después el WebSocket autenticado del agente; en Web solo sirve para preview porque no existe TCP nativo.

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
- **Vinculación:** token temporal generado por Desktop, menú de conexión SSH/Relay y huella de host opcional pero recomendada.
- **Identidad visual:** fondo carbón, superficies discretas, naranja HELIX como acento y navegación táctil nativa de Flutter.

## Límites conocidos

- El agente actual solo escucha en loopback; el relay SSH requiere que el host remoto tenga SSH habilitado.
- El pairing temporal y el relay están implementados; aún falta desplegar el relay detrás de TLS y una política de revocación por dispositivo con scopes más finos.
- No existe todavía un APK firmado ni evidencia de prueba en dispositivos físicos.

Consultar `docs/roadmap.md` antes de ampliar el alcance.
