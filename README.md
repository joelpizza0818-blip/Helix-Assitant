# HELIX

HELIX is a local-first desktop agent for working with the operating system, terminal, and context the user chooses to share. It combines a desktop shell, Python agent, explicit permission controls, configurable AI providers, and a CLI for supported workflows.

> Code versions in the current checkout: Normal `0.2.13`, Lite `0.2.13`, CLI `0.2.14`, and Mobile `0.1.0`. These values do not by themselves prove publication; verify each channel's release and assets independently.

Links: [landing](https://helix-assistant.vercel.app) · [downloads](https://helix-assistant.vercel.app/download) · [capabilities](https://helix-assistant.vercel.app/features) · [web docs](https://helix-assistant.vercel.app/docs) · [releases](https://github.com/joelpizza0818-blip/Helix-Assitant/releases)

## Capabilities

- Desktop conversation and task execution.
- OS, file, browser, screen, voice, camera, and gesture tools when configured and available.
- Model routing with capability filtering and controlled provider/key fallback.
- Human confirmation for system and critical actions, including automatic modes.
- Reviewable skills and local stdio MCP servers.
- Memory and context retrieval; the Context Compression Layer packs large content into recoverable blocks.
- CLI autocompletion with UTF-8, CP1252, and codepage 65001 handling.
- Separate Normal (Electron) and Lite (Tauri) desktop shells.

HELIX does not grant implicit authority or promise universal automation. Tool availability depends on policy, provider, operating system, hardware, and local configuration.

## Products and support matrix

| Product | Supported platform | Distribution | Support status |
|---|---|---|---|
| HELIX Normal | Windows x64, Electron | `v0.2.13` | Primary desktop product; verify current release asset and checksum |
| HELIX Lite | Windows x64, Tauri/NSIS | `lite-v0.2.13` | Independent lightweight shell; verify release asset separately |
| HELIX Mobile | Android via Flutter | `mobile-vX.Y.Z` | Build workflow exists; signed public APK is not confirmed |
| HELIX CLI | Node.js on Windows, macOS, and Linux where dependencies are available | `npx helix-assistant-cli` | Source version `0.4.1`; npm publication requires stage approval |
| Server | Express/Prisma in its configured deployment environment | internal service | API, tasks, and update subscriptions |
| Landing | Modern browser | Vercel | Public site, docs, and downloads |

Official desktop installers are currently Windows x64. Do not describe macOS or Linux desktop installers as supported until a verified workflow and artifact exist.

## Architecture

```text
User interfaces: Electron/React Normal · Tauri/Rust Lite · TypeScript CLI
                                │
                    authenticated local WebSocket
                    127.0.0.1:8765
                                │
Python agent: orchestration · model routing · tasks · tools
              permissions · memory · MCP/skills · perception
                                │
       configured providers · local OS/hardware · optional services
       Express · Prisma/PostgreSQL/Supabase · landing · releases
```

| Area | Responsibility |
|---|---|
| `apps/desktop` | Electron lifecycle, preload/IPC, React renderer, Toolbox, updater, diagnostics |
| `apps/desktop-tauri` | Lite shell and Rust bridge |
| `apps/cli` | Interactive terminal client |
| `services/agent` | Python runtime, orchestration, tools, perception, security |
| `server` | Express API, Prisma, tasks, models, update subscriptions |
| `apps/landing` | Public content, downloads, SEO, and local EN/ES UI |
| `config` | Shared catalogs and configuration |

## Quick start

### CLI

```bash
npx helix-assistant-cli
npm install --global helix-assistant-cli
helix
```

The CLI needs an accessible agent and a configured provider for AI-backed tasks. Available commands depend on enabled skills and MCP servers.

The interactive CLI includes `/subagents` for an ASCII status panel and direct subagent chat. `/browser live on` displays bounded ASCII snapshots produced after successful browser actions; this is not continuous video.

### Desktop

Download from the [official page](https://helix-assistant.vercel.app/download), verify the published checksum when available, and run the Windows x64 installer.

### From source

Recommended requirements: Node.js 20+, npm, Python 3.11, and native build tools for the capabilities being tested. Rust is required for Lite builds.

```powershell
git clone https://github.com/joelpizza0818-blip/Helix-Assitant.git
Set-Location Helix-Assitant
.\scripts\setup.ps1
npm ci
npm run dev:desktop
```

Useful commands:

```powershell
npm run dev:desktop
npm run dev:landing
npm run dev:server
npm run build:desktop
npm run build:desktop-tauri
npm run build:landing
npm run build:server
```

## Configuration and secrets

Use a local `.env` or the deployment secret manager. Never commit keys, tokens, passwords, cookies, or signing material.

| Area | Variables | Purpose |
|---|---|---|
| Database | `DATABASE_URL`, `DIRECT_URL` | Prisma/PostgreSQL and migrations |
| Supabase | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | API and authentication; service role is server-only |
| Desktop and Landing | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` | Public/publishable web configuration |
| Administration | `ADMIN_TOKEN` or `HELIX_ADMIN_TOKEN` | Protected operations and broadcasts |
| Community moderation | `HELIX_COMMUNITY_MODERATOR_EMAILS` | Server-side email allowlist; empty disables Community reviews |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `SMTP_FROM` | Real release email delivery |
| Providers | `OPENAI_API_KEY_*`, `ANTHROPIC_API_KEY_*`, `GOOGLE_API_KEY_*` | Configured AI providers |
| Agent | `AGENT_WS_PORT`, `LOG_LEVEL`, `VOICE_ENABLED`, `CAMERA_ENABLED` | Runtime, logs, and perception |

See [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) before adding variables.

Community submissions contain only HTTPS plugin destinations or skill instruction text. They remain private until approved by a moderator. Plugins open in HELIX's paired browser tab and use the user's regular browser session; skills install locally and never run uploaded scripts.

## Security and privacy

Operations are classified as read-only, low-risk, modify, execute, system, or critical. System and critical actions require human confirmation. Defenses include sanitized subprocess environments, blocked encoded/dynamic command forms, validated paths and payloads, configurable sandboxing, explicit IPC/WebSocket contracts, HTML/URL/CRLF sanitization, BCC subscriber delivery, and protected rotating logs.

The core keeps work local where the capability allows it. Authentication, AI providers, downloads, Supabase, GitHub, and SMTP may transfer or store data outside the local process. Review each MCP server before enabling it and read the [privacy policy](https://helix-assistant.vercel.app/privacy).

Update subscribers are stored durably in PostgreSQL through Prisma table `update_subscribers`, with normalized email, active state, and unique deduplication. Delivery still depends on SMTP, DNS, reputation, and the release workflow.

## Quality and testing

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

Evidence must be labeled as automated, static, manual, installation, hardware, or external-service evidence. A green build alone does not prove SMTP delivery, camera access, installer updates, or Search Console indexing.

## Release process

Treat each product as a separate release channel:

- `vX.Y.Z`: Normal/core.
- `lite-vX.Y.Z`: Lite.
- `mobile-vX.Y.Z`: Android/mobile workflow.
- CLI uses its npm package version and a separately approved publish stage.

Confirm tags, artifacts, signatures, checksums, npm state, and production deployments independently for each channel before describing it as released. Linux/macOS desktop installers are not currently verified; CI tests for the agent/relay do not establish desktop installer support.

Before publishing: align each channel's manifest and tag, run its required checks, review the diff, create tags from a clean commit, and verify signatures and checksums for every published installer. Database migrations and production announcements are separate operations and require their own approval.

## Operations and troubleshooting

- Agent connection: check `127.0.0.1:8765`, logs, and WebSocket authentication.
- Missing tool: check capabilities, skills, MCP configuration, and permissions.
- Voice/camera failure: check Windows permissions, RDP/ICA state, model files, and device availability.
- Missing update email: check `update_subscribers`, admin token, SMTP, rate limits, and logs.
- Encoding CI failure: run `npm run lint:encoding` on the same commit.
- Indexing issue: check canonical, sitemap, robots, crawlable links, browser console, and Search Console; a sitemap does not guarantee indexing.

## Contributing

Read the relevant Helix-vault notes first, inspect existing contracts and consumers, make the smallest safe change, add tests, review encoding/secrets/migrations, update affected documentation, and describe limits in the pull request. Do not close work because code exists; close it when appropriate evidence exists.

## Related documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md)
- [`docs/PROJECT_FLOW.md`](docs/PROJECT_FLOW.md)
- [`docs/WAKE_WORD_TRAINING.md`](docs/WAKE_WORD_TRAINING.md)
- `Helix-vault/08 - Gobernanza y producto/`

HELIX remains under active development. Platform, hardware, provider, and external-service limits must be re-verified for every release.
