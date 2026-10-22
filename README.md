# HELIX - Persistent AI Assistant & Desktop Agent

HELIX is an advanced AI desktop agent tailored for multi-shell execution across Windows, macOS, and Linux, providing deep OS integration, seamless automation, and contextual awareness via voice, vision, screen perception, and terminal interaction.

🌐 **Official Website & Downloads:** [https://helix-assistant.vercel.app](https://helix-assistant.vercel.app)  
📦 **Releases:** [Download HELIX Normal, Lite & CLI](https://helix-assistant.vercel.app/download)  
📖 **Documentation:** [HELIX Docs](https://helix-assistant.vercel.app/docs) • **Features:** [Capabilities](https://helix-assistant.vercel.app/features)

---

## Multi-Shell Architecture

HELIX provides three specialized shells sharing the same local Python perception and reasoning runtime (`ws://127.0.0.1:8765`):

```text
                               ┌────────────────────────────────────────────────────────┐
                               │                    Operating System                    │
                               │               (Windows / macOS / Linux)                │
                               └───────────────────────────┬────────────────────────────┘
                                                           │
              ┌────────────────────────────────────────────┼────────────────────────────────────────────┐
              │                                            │                                            │
              ▼                                            ▼                                            ▼
   HELIX Normal (Electron)                      HELIX Lite (Tauri)                           HELIX CLI
   apps/desktop                                 apps/desktop-tauri                           apps/cli (helix-assistant-cli)
   - Full React/Electron UI                     - Lightweight Rust/Tauri binary              - Interactive terminal REPL
   - Integrated floating pill & Toolbox         - Ultra-fast startup, ~15MB base             - Auto-complete for @skills & #mcps
   - Live system admin logs stream              - Native webview rendering                   - Cross-platform UTF-8/CP1252/CP65001
   - PyInstaller agent runtime bundled          - Low memory footprint                       - Direct npx execution
              │                                            │                                            │
              └────────────────────────────────────────────┼────────────────────────────────────────────┘
                                                           │ WebSocket (127.0.0.1:8765)
                                                           ▼
                                         ┌───────────────────────────────────┐
                                         │       HELIX Agent (Python)        │
                                         ├───────────────────────────────────┤
                                         │ • AI Orchestrator & ReAct Loop    │
                                         │ • Multi-Provider Router & Fallback│
                                         │ • OpenWakeWord & Faster-Whisper   │
                                         │ • MediaPipe Gesture Recognition   │
                                         │ • Permission Manager & Sandboxing │
                                         │ • Local MCP & Tool Execution      │
                                         └───────────────────────────────────┘
```

### Choosing the Right Shell

| Shell | Target Audience | Primary Strengths | Install / Run Command |
|---|---|---|---|
| **HELIX Normal (Electron)** | Daily desktop automation & Power users | Full feature set, embedded local models, live Toolbox, visual Admin diagnostics | `HELIX-Setup-0.2.4.exe` (Windows x64) |
| **HELIX Lite (Tauri)** | Low-spec machines & Minimalists | Extremely fast startup, ~15MB binary, minimal idle memory consumption | `HELIX-Lite-Setup.exe` (Windows x64) |
| **HELIX CLI** | Developers & Headless / Remote environments | Interactive terminal REPL, zero-overhead GUI, runs anywhere Node is available | `npx helix-assistant-cli` |

---

## Version Governance & Hierarchy

To maintain coherence across packages in this monorepo, version numbers follow a strictly defined hierarchy:

1. **Global Product Release Version (`v0.2.4`)**:
   - Represents the user-facing release of HELIX.
   - Tagged in Git as `vX.Y.Z` (Electron & core) and `lite-vX.Y.Z` (Tauri Lite).
   - Mirrored in `apps/desktop/package.json`, `apps/cli/package.json`, and `apps/desktop-tauri/src-tauri/tauri.conf.json`.

2. **Monorepo Root Manifest (`1.0.0`)**:
   - Manages developer workspaces, shared dev dependencies, formatting tools, and build orchestration scripts.

3. **Internal Sub-service Manifests (`0.1.0`)**:
   - `server/package.json` and `apps/landing/package.json` maintain independent service release lifecycles.

---

## Quick Start & Installation

### Option 1: Interactive Terminal CLI (Instant)

Run directly without manual installation:

```bash
npx helix-assistant-cli
```

Or install globally:

```bash
npm install -g helix-assistant-cli
helix
```

### Option 2: Desktop Applications (Windows Installer)

Download the installer from the [Official Downloads Page](https://helix-assistant.vercel.app/download) or build from source:

```powershell
# 1. Clone repository
git clone https://github.com/joelpizza0818-blip/Helix-Assitant.git
cd Helix-Assitant

# 2. Run automated setup (installs Node & Python requirements)
.\scripts\setup.ps1

# 3. Build standalone Windows installer
npm run build --workspace=@helix/desktop
```

The resulting standalone executable is generated in `apps/desktop/release/`.

---

## Security & Execution Sandboxing

HELIX implements privilege separation through `PermissionManager`:
- **Read-Only / Low-Risk:** Inspected files, UI inspection, cursor movements.
- **Modify:** File creation, directory management, window adjustments.
- **System / Critical:** Command execution, destructive filesystem changes, process killing.
- **Sandboxing & Isolation:** In Toolbox > Security, users can enable **Command Sandboxing** to execute shell and PowerShell commands with sanitized environment variables (stripping API keys and secrets), restricted execution policies, and isolated process boundaries.

---

## Directory Structure

```text
Helix-Assistant/
├── apps/
│   ├── cli/             # Interactive TypeScript terminal shell (helix-assistant-cli)
│   ├── desktop/         # Full Electron & React desktop application
│   ├── desktop-tauri/   # Lightweight Tauri / Rust desktop shell
│   └── landing/         # Marketing, scrollytelling & release distribution web app
├── config/              # Shared runtime and environment configuration
├── docs/                # Architecture and technical documentation
├── scripts/             # Build, staging, and packaging automation scripts
├── server/              # Express / Prisma backend services and telemetry API
├── services/
│   └── agent/           # Python agent core: perception, orchestrator, tools, AI providers
└── tools/               # Auxiliary developer utilities and test doubles
```

---

## Documentation Links

- [Environment & Configuration Guide](docs/ENVIRONMENT.md)
- [Architecture Deep Dive](docs/ARCHITECTURE.md)
- [Project Workflow & Lifecycle](docs/PROJECT_FLOW.md)
