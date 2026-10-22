# HELIX

HELIX es un agente de escritorio local-first para trabajar con el sistema operativo, la terminal y el contexto que el usuario decide compartir. Combina una interfaz de escritorio, un agente Python, herramientas con permisos explícitos, proveedores de IA configurables y un CLI para flujos compatibles.

> Estado: release `v0.2.6` en publicación. La compatibilidad indicada aquí distingue entre implementación, pruebas y validación manual.

Enlaces: [landing](https://helix-assistant.vercel.app) · [descargas](https://helix-assistant.vercel.app/download) · [capacidades](https://helix-assistant.vercel.app/features) · [docs web](https://helix-assistant.vercel.app/docs) · [releases](https://github.com/joelpizza0818-blip/Helix-Assitant/releases)

## Qué ofrece

- Conversación y ejecución de tareas desde la aplicación de escritorio.
- Herramientas de sistema, archivos, navegador, pantalla, voz, cámara y gestos según configuración, hardware y permisos.
- Router de modelos para proveedores configurados, con validación de credenciales y fallback controlado.
- Confirmaciones humanas para acciones de riesgo alto, sistema o críticas.
- MCP y skills configurables, revisables antes de habilitarlos.
- Memoria y recuperación de contexto; la Context Compression Layer reduce contexto repetido y conserva bloques recuperables bajo demanda.
- CLI interactivo con autocompletado y compatibilidad UTF-8, CP1252 y codepage 65001.
- HELIX Normal y HELIX Lite como shells de escritorio independientes.

HELIX no concede permisos implícitos ni promete automatización universal: cada herramienta depende de la política, el proveedor, el sistema operativo, el hardware y la configuración activa.

## Productos y plataformas

| Producto | Plataforma | Distribución | Soporte |
|---|---|---|---|
| HELIX Normal | Windows x64, Electron | `HELIX-Setup-0.2.6.exe` | Escritorio principal |
| HELIX Lite | Windows x64, Tauri/NSIS | `lite-v0.2.6` | Shell ligero independiente |
| HELIX CLI | Node.js en Windows, macOS y Linux, según dependencias | `npx helix-assistant-cli` | Terminal y flujos headless compatibles |
| Servidor | Express/Prisma en entorno configurado | servicio interno | API, tareas y actualizaciones |
| Landing | Navegador moderno | Vercel | Web pública, docs y descargas |

La aplicación de escritorio publicada actualmente está orientada a Windows x64. macOS y Linux no deben presentarse como instaladores de escritorio oficiales sin workflow y artefacto verificado.

## Arquitectura

```text
Interfaces: Electron/React Normal · Tauri/Rust Lite · CLI TypeScript
                                │
                     WebSocket local autenticado
                     127.0.0.1:8765
                                │
Agente Python: orquestador ReAct · router · sesiones · permisos
               tools · MCP · percepción · compresión de contexto
                                │
       proveedores configurados / hardware local / servicios opcionales
       Express · Prisma/PostgreSQL/Supabase · landing · releases
```

Responsabilidades:

- `apps/desktop`: Electron, preload, IPC, renderer React, Toolbox, updater y diagnóstico.
- `apps/desktop-tauri`: shell Lite y puente Tauri; comparte renderer donde el contrato lo permite.
- `apps/cli`: cliente de terminal y experiencia interactiva.
- `services/agent`: runtime Python, orquestación, herramientas, percepción y seguridad.
- `server`: API Express, Prisma, tareas, modelos y suscripciones.
- `apps/landing`: contenido público, descargas, documentación, SEO y localización EN/ES.
- `config`: catálogos y configuración compartida; los secretos quedan fuera del repositorio.

## Instalación rápida

### CLI

```bash
npx helix-assistant-cli
npm install --global helix-assistant-cli
helix
```

El CLI necesita un agente accesible y un proveedor válido para tareas que requieran IA. Los comandos dependen de skills y MCP habilitados.

### Escritorio

Descarga desde la [página oficial](https://helix-assistant.vercel.app/download). Verifica el checksum publicado cuando esté disponible y ejecuta el instalador en Windows x64.

### Código fuente

Requisitos recomendados: Node.js 20+, npm, Python 3.11, y herramientas nativas para la capacidad que se quiera probar. Rust es necesario para Lite.

```powershell
git clone https://github.com/joelpizza0818-blip/Helix-Assitant.git
Set-Location Helix-Assitant
.\scripts\setup.ps1
npm ci
npm run dev:desktop
```

```powershell
npm run dev:desktop
npm run dev:landing
npm run dev:server
npm run build:desktop
npm run build:landing
npm run build:server
```

## Configuración y secretos

Usa `.env` local o secretos del entorno de despliegue. Nunca subas claves, tokens, contraseñas, cookies ni material de firma.

| Área | Variables | Uso |
|---|---|---|
| DB | `DATABASE_URL`, `DIRECT_URL` | Prisma/PostgreSQL y migraciones |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | API y landing autenticada |
| Administración | `ADMIN_TOKEN` o `HELIX_ADMIN_TOKEN` | Operaciones protegidas y broadcast |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Avisos de releases |
| IA | `OPENAI_API_KEY_*`, `ANTHROPIC_API_KEY_*`, `GOOGLE_API_KEY_*` | Proveedores configurados |
| Agente | `AGENT_WS_PORT`, `LOG_LEVEL`, `VOICE_ENABLED`, `CAMERA_ENABLED` | Transporte, logs y percepción |

Consulta [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) antes de añadir variables.

## Seguridad y permisos

HELIX clasifica operaciones como lectura, bajo riesgo, modificación, ejecución, sistema o crítica. Las acciones de sistema/críticas requieren confirmación humana; el modo automático no debe saltarse esa barrera.

Incluye saneamiento de variables sensibles, bloqueo de comandos codificados y alias destructivos, validación de rutas y payloads, sandbox configurable, contratos IPC/WebSocket, sanitización HTML/URL/CRLF, BCC de suscriptores y logs administrativos protegidos.

La seguridad final depende también de Windows, permisos del usuario, proveedores externos, MCP y hardware. Revisa cada servidor MCP antes de habilitarlo.

## Datos y privacidad

El núcleo mantiene el trabajo local cuando la capacidad lo permite. Autenticación, proveedores externos, descargas, Supabase, GitHub y SMTP pueden transferir o almacenar datos fuera del proceso local. Consulta la [política de privacidad](https://helix-assistant.vercel.app/privacy).

Las novedades se almacenan en PostgreSQL mediante Prisma en `update_subscribers`, con deduplicación por correo y estado activo. Esto no garantiza por sí solo la entrega: también dependen SMTP, DNS, reputación y el workflow de release.

## Calidad y pruebas

```powershell
npm run lint:encoding
npm run models:check
npm test
npm run test:promptfoo
npm run test:k6
npm run typecheck --workspace=@helix/desktop
npm run build --workspace=@helix/landing
npm test --workspace=@helix/server
npm test --workspace=helix-assistant-cli
python -m pytest services/agent/tests/ -v
```

La evidencia debe distinguir automatizada, estática, manual, instalación, hardware y servicios externos. Un build verde no demuestra por sí solo que hardware, correo, instalación o servicios remotos funcionen.

## Releases

Versión de producto: `0.2.6`.

- `v0.2.6`: HELIX Normal/core.
- `lite-v0.2.6`: HELIX Lite.
- `helix-assistant-cli@0.2.6`: CLI npm.

Antes de publicar: sincronizar manifiestos/lockfiles, ejecutar pruebas, revisar diff, aplicar `npm run db:deploy` desde el entorno aprobado, crear tags desde commit limpio, verificar instaladores/checksums y ejecutar broadcast solo con SMTP configurado.

Workflows: calidad, multiplataforma, release Normal, release Lite, publicación CLI y capability packs.

## Operación y diagnóstico

- Sin conexión del agente: revisa `127.0.0.1:8765`, logs y autenticación WebSocket.
- Sin herramienta: revisa capabilities, skills, MCP y permisos.
- Sin voz/cámara: revisa permisos Windows, sesión RDP/ICA, modelos empaquetados y dispositivo.
- Sin notificación: revisa `update_subscribers`, token admin, SMTP, rate limit y logs; no reintentes a ciegas.
- Fallo de encoding en CI: ejecuta `npm run lint:encoding` en el mismo commit.
- Problemas de indexación: revisa canonical, sitemap, robots, enlaces HTML, consola y Search Console; sitemap no garantiza indexación.

## Estructura

```text
apps/desktop/              Electron + React Normal
apps/desktop-tauri/        shell Lite Tauri/Rust
apps/cli/                  CLI npm
apps/landing/              landing, descargas y SEO
server/                    Express + Prisma + migraciones
services/agent/            runtime Python y herramientas
config/                    catálogos compartidos
scripts/                   setup, build y publicación
docs/                      guías técnicas
.github/workflows/         calidad y distribución
```

## Contribución

Lee primero las notas pertinentes de `Helix-vault`, inspecciona consumidores y contratos, realiza el cambio mínimo, añade pruebas, revisa encoding/secretos/migraciones, actualiza documentación afectada y describe límites en el pull request. No cierres una tarea solo porque exista código: debe existir evidencia adecuada.

## Documentación relacionada

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md)
- [`docs/PROJECT_FLOW.md`](docs/PROJECT_FLOW.md)
- [`docs/WAKE_WORD_TRAINING.md`](docs/WAKE_WORD_TRAINING.md)
- `Helix-vault/08 - Gobernanza y producto/`

HELIX continúa en desarrollo. Los límites de plataforma, hardware, proveedores y servicios remotos deben verificarse en cada release.
