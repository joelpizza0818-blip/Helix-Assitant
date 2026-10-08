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

The release build creates a standalone NSIS installer with the Python agent bundled inside it. A user installs HELIX and launches it from the Start menu or desktop shortcut; no terminal startup command is required.

On a Windows build machine with the project dependencies installed, run:

```powershell
.\scripts\setup.ps1
npm run build:windows
```

The setup script installs the PyInstaller build dependency from
`services/agent/requirements.txt`; `build:windows` produces and embeds the
standalone agent executable before building the NSIS installer.

The installer is written to `apps/desktop/release/HELIX-Setup-<version>.exe` and copied to `apps/landing/public/downloads/HELIX-Setup.exe`, which is the landing page's default download URL. Deploy the resulting `apps/landing/dist` together with that staged `downloads` file. Set `VITE_HELIX_WINDOWS_INSTALLER_URL` at landing build time when releases are hosted at another URL.

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
