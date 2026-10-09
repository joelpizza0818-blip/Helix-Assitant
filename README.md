# HELIX - Persistent Windows AI Desktop Agent

HELIX is an advanced AI desktop agent tailored for Windows, providing deep OS integration, seamless automation, and contextual awareness via voice, vision, and screen perception.

## Architecture Overview

```text
Windows OS
   │
   ├─ HELIX Desktop Shell (Electron/React UI)
   │
   └─ HELIX Agent Process (Python)
        ├─ AI Orchestrator
        ├─ Model Router & Fallback System
        ├─ Task Manager
        ├─ Memory Subsystem
        ├─ Perception (Voice, Vision, Gesture, Screen)
        ├─ Tool System
        ├─ Security & Permission Manager
        ├─ OS Integration
        ├─ Browser Automation
        └─ Providers (OpenAI, Anthropic, Google)
```

## Prerequisites
- Node.js >= 18
- Python >= 3.10
- PostgreSQL (or Supabase)
- Windows 10/11

## Setup Steps
1. Clone the repository
2. Run `.\scripts\setup.ps1` from PowerShell
3. Copy `.env.example` to `.env` and configure keys
4. See [Environment Guide](docs/ENVIRONMENT.md) for configuration details

## Windows Installer Build

The release build creates a standalone NSIS installer with the Python agent and GitHub CLI bundled inside it. A user installs HELIX and launches it from the Start menu or desktop shortcut; no terminal startup command is required.

On a Windows build machine with the project dependencies installed, run:

```powershell
.\scripts\setup.ps1
npm run build:windows
```

The setup script installs the PyInstaller build dependency from
`services/agent/requirements.txt`; `build:windows` produces and embeds the
standalone agent executable and checksum-verifies the pinned official GitHub CLI
before building the NSIS installer.

The installer is written to `apps/desktop/release/HELIX-Setup-<version>.exe`
and staged privately at `apps/landing/private-downloads/HELIX-Setup.exe`.
Publishing a stable release with a tag matching `apps/desktop/package.json`
(for example, `v0.1.5`) starts the
[Windows installer workflow](.github/workflows/publish-windows-installer.yml).
It rebuilds the installer from that exact source tag, uploads the installer,
SHA-256 checksum, NSIS blockmap, and `latest.yml` metadata to the private
`helix-installer-downloads` repository, and verifies the published asset and
latest-release tag.

Configure the `INSTALLER_REPO_TOKEN` Actions secret with a fine-grained token
restricted to `helix-installer-downloads`, with Contents read/write access.
The workflow can also be run manually from `main` to rebuild the current
desktop package version. The landing download function reads the latest private
release dynamically, so publishing a new installer does not require a landing
redeploy. Never place the installer under `apps/landing/public`.

Installed HELIX checks for updates at startup and exposes manual checking,
download progress, and restart-to-install in Toolbox > Updates. The public
`installer-updates` Supabase Edge Function serves only update metadata and
versioned HELIX installer assets; its GitHub token remains server-side. Deploy
it with the existing `GITHUB_INSTALLER_OWNER`, `GITHUB_INSTALLER_REPO`, and
`GITHUB_INSTALLER_TOKEN` Supabase secrets before publishing an updater-enabled
release. Existing v0.1.0 installations do not contain updater code, so they
must install the current Windows installer once; later versions can update
in-app.

## Desktop companions

The Toolbox includes an in-memory clipboard history (up to 30 text/image
entries) that can be paused or cleared. The browser companion can be loaded
unpacked in Chrome or Edge from the Toolbox; it sends visible page text, links,
and form labels to the local HELIX agent, but not form values. Clipboard entries
and browser page snapshots are not persisted by these features.

## Directory Structure
- `apps/desktop`: Electron/React desktop application
- `apps/landing`: Web landing page
- `server`: Backend API/Services
- `shared`: Shared TypeScript types and constants
- `docs`: Documentation
- `scripts`: Utility and setup scripts
- `services/agent`: Python core agent logic

## Documentation
- [Environment & Config](docs/ENVIRONMENT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Project flow](docs/PROJECT_FLOW.md)
