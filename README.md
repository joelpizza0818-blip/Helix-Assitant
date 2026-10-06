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
