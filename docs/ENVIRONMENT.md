# HELIX Environment and Configuration

This guide defines local development and deployment configuration. Treat environment files as secret material: `.env` must never be committed, pasted into issues, or copied into release notes.

## Setup

From the repository root:

```powershell
npm ci
.\scripts\setup.ps1
```

Create a local `.env` from the repository example when available. Keep production values in the deployment secret manager. The agent resolves the root environment independently of its working directory.

## Configuration groups

| Group | Variables | Notes |
|---|---|---|
| Agent transport | `AGENT_WS_PORT`, `LOG_LEVEL`, `LOG_FILE` | Local WebSocket and diagnostics |
| Database | `DATABASE_URL`, `DIRECT_URL` | Prisma PostgreSQL connection and migrations |
| Supabase | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Service-role key is server-only |
| Landing | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` | Only public/publishable values belong in Vite |
| Administration | `ADMIN_TOKEN` or `HELIX_ADMIN_TOKEN` | Required for protected broadcasts |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `SMTP_FROM` | Required for real update delivery |
| Providers | `OPENAI_API_KEY_*`, `ANTHROPIC_API_KEY_*`, `GOOGLE_API_KEY_*` | Up to three keys per provider |
| Voice | `STT_PROVIDER`, `STT_MODEL`, `TTS_PROVIDER`, `TTS_MODEL`, `VOICE_ENABLED` | Local or online speech paths |
| Vision | `CAMERA_ENABLED`, `CAMERA_DEVICE_INDEX`, `VISION_PROVIDER` | Hardware and MediaPipe configuration |
| Wake word | `WAKE_WORD`, `WAKE_WORD_PROVIDER`, `WAKE_WORD_MODEL_PATH`, `WAKE_WORD_THRESHOLD` | Requires a matching model file |

## Provider routing

Empty provider keys disable that provider. Keys are tried in configured order; eligible rate limits can move to the next key. Cross-provider fallback is opt-in/configured and may incur additional charges. A model is eligible only when its registered capabilities satisfy the request.

Confirmed model-unavailable responses can remove a model for the current agent process. Quota and billing failures are scoped to the current execution/key according to the router implementation; they do not silently delete the configuration.

Keep model identifiers current with the provider's official documentation. Do not document a model as supported only because it exists in a catalog; verify account access and a real request.

## Database and migrations

The server uses Prisma with PostgreSQL/Supabase:

```powershell
npm run db:generate --workspace=@helix/server
npm run db:deploy --workspace=@helix/server
npx prisma migrate status --schema server/prisma/schema.prisma
```

`supabase_auth_user_sync` targets Supabase PostgreSQL because it references `auth.users`. Do not apply it to an unrelated PostgreSQL database. Prisma migrations and Supabase migration histories must not manage the same objects without an explicit ownership decision.

The update subscriber table is `update_subscribers`. It stores normalized email, active state, timestamps, and an unsubscribe timestamp. Production must use PostgreSQL; the in-memory fallback exists only for isolated tests/local runs without a database.

## Authentication and downloads

The landing uses Supabase OAuth. Configure the GitHub provider in Supabase, set the deployed site URL and allowed redirects, and never place the OAuth client secret in Vite variables. Desktop OAuth uses the `helix://auth/callback` redirect.

Installers are private release assets. The public download flow should issue a temporary asset URL only after the configured authentication and profile checks. Do not copy private installer assets into `apps/landing/public`.

## Desktop runtime

The desktop shell starts Python on `AGENT_WS_PORT` (default `8765`) and selects an available local port when needed. Preferences are stored in the Electron per-user data directory, not in `.env`. MCP currently supports trusted local stdio servers; URL/HTTP configurations are rejected. Before adding network MCP, document SSRF, redirects, authentication, timeouts, and secret-safe diagnostics.

## Perception

- Local speech uses faster-whisper when configured; the first model load may download/cache model data.
- Edge TTS sends spoken response text to Microsoft's service; system speech stays local.
- Camera and gestures require device access, models, OpenCV/MediaPipe, confidence, stability and cooldown settings.
- RDP/ICA sessions may disable hardware perception gracefully.
- `WAKE_WORD="hey helix"` requires the matching ONNX classifier; see [WAKE_WORD_TRAINING.md](./WAKE_WORD_TRAINING.md).

## Secret handling checklist

1. Keep `.env` ignored and outside artifacts.
2. Use least-privilege, scoped tokens.
3. Rotate any value exposed in logs or screenshots.
4. Never pass provider keys into tool subprocesses.
5. Use different credentials for local, staging, and production.
6. Validate deployment variables before migrating or publishing.
