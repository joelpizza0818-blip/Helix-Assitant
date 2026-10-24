# HELIX — Contexto General

## ¿Qué es HELIX?

HELIX es un asistente de IA de escritorio (Windows) con capacidades de percepción visual, voz, control del sistema y chat. Opera de forma local: el agente Python corre en el equipo del usuario y se conecta a proveedores de IA configurables (Gemini, Claude, GPT).

## Componentes principales

| Componente | Ruta | Descripción |
|-----------|------|-------------|
| Desktop (Electron) | `apps/desktop` | Shell principal Windows. Bandeja del sistema, atajos globales, OCR, voz. |
| Desktop Tauri (Lite) | `apps/desktop-tauri` | Shell alternativo en Rust/Tauri para Windows. Canal de release independiente. |
| Landing | `apps/landing` | Sitio React/Vite en Vercel. Página de descarga, changelog, suscripción. |
| CLI | `apps/cli` | Paquete npm `helix-assistant-cli` ejecutable con `npx`. |
| Mobile | `movil/` | App Flutter multiplataforma. Conecta al Desktop via WSS relay o SSH. |
| Relay | `services/relay/server.py` | Servidor WebSocket Python que actúa de intermediario Desktop↔Mobile. |
| Agent | `services/agent/` | Núcleo del agente Python. |
| Server | `server/` | Backend Node/Hono con Prisma. API REST y autenticación. |

## Paleta de colores (HELIX Brand)

| Token | Hex | Uso |
|-------|-----|-----|
| `--canvas` | `#101010` | Fondo base |
| `--carbon` | `#1D1A18` | Superficies elevadas |
| `--orange` | `#EE6018` | CTA principal, accent |
| `--bone` | `#EEEEEE` | Texto primario |
| `--muted` | `#8A8380` | Texto secundario |
| `--green` | `#A0CA92` | Estado OK |
| `--red` | `#D4544A` | Estado error |

## Convenciones de código

- **TypeScript** en Desktop/Landing/Server
- **Flutter/Dart** en Mobile
- **Python** en Agent/Relay
- Tests: `vitest` (TS), `pytest` (Python), `flutter test` (Dart)
- Relay se ejecuta en puerto `8787` por defecto

## Releases publicados

| Edición | Canal | Etiqueta GitHub |
|---------|-------|----------------|
| HELIX Normal | Electron Windows x64 | `vX.X.X` |
| HELIX Lite | Tauri Windows x64 | `lite-vX.X.X` |
| HELIX Mobile | APK Android | `mobile-vX.X.X` *(pendiente)* |
| HELIX CLI | npm | `helix-assistant-cli` |
