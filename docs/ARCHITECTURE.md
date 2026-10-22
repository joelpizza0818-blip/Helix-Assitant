# HELIX Architecture

This document describes the current runtime boundaries and contracts. It is an implementation guide, not a promise that every optional capability is enabled in every installation. For build and release sequencing, see [PROJECT_FLOW.md](./PROJECT_FLOW.md).

## System context

```text
┌──────────────────────────────────────────────────────────────┐
│ User interfaces: Electron/React · Tauri/Rust Lite · CLI       │
└───────────────────────────────┬──────────────────────────────┘
                                │ local authenticated WebSocket
                                │ 127.0.0.1:8765
┌───────────────────────────────▼──────────────────────────────┐
│ Python agent                                                   │
│ request handling · orchestration · tools · permissions         │
│ model routing · memory · MCP/skills · optional perception       │
└───────────────┬───────────────────────────┬──────────────────┘
                │                           │
       configured AI providers       local OS and hardware
```

The Express/Prisma server, Supabase Edge Functions, and landing are separate service boundaries. They are not part of the local Electron–Python request path.

## Component responsibilities

| Component | Responsibility | Trust boundary |
|---|---|---|
| Electron main/preload | Window lifecycle, tray, IPC allowlist, Python process lifecycle | Native desktop boundary |
| React renderer | Conversation, tasks, settings and Toolbox UI | No direct Node access |
| Tauri shell | Lightweight desktop shell and Rust bridge | Native desktop boundary |
| CLI | Terminal client and interactive commands | User terminal boundary |
| Python agent | Tasks, planning, model calls, tools and events | Local execution boundary |
| Permission manager | Risk classification, confirmation and denial | Safety gate before effects |
| Model router | Capability filtering, provider/key fallback and model selection | External provider boundary |
| Perception | Optional voice, screen, camera and gesture signals | Hardware/privacy boundary |
| Express/Prisma | Accounts, settings, tasks, models and update subscriptions | Network/database boundary |

## Request lifecycle

1. A request enters through the renderer, CLI, voice event, or gesture event.
2. The shell forwards it through the preload/IPC contract or local WebSocket.
3. The agent creates a task and prepares session context.
4. The orchestrator selects conversation, planning, delegation, or direct tool execution.
5. The model router filters models by required capabilities and configured providers.
6. A tool call is checked by the permission manager.
7. The tool is denied, waits for confirmation, or executes with sanitized inputs.
8. Results return to the model context and are emitted as task/message events.
9. The shell renders the final result and lifecycle state.

## Context and compression

Long tool outputs and conversation tails may be packed by the Context Compression Layer. Packed blocks retain a stable identifier and can be retrieved by the agent's context-retrieve tool. Compression reduces prompt size; it does not claim lossless semantic summarization unless the original block is retrieved.

## Security invariants

- The renderer does not receive unrestricted Node.js access.
- System and critical actions require human confirmation, including automatic modes.
- Tool subprocesses receive a sanitized environment and reject disallowed command forms.
- External MCP URLs are not an implicit capability; local stdio servers are the supported boundary.
- Credentials are never written to logs, prompts, documentation, or release notes.
- Server broadcasts accept only registered active subscribers and use BCC.

## Failure and degradation

Optional perception must fail closed: missing models, unavailable hardware, RDP sessions, or missing dependencies produce diagnostics and disable that capability rather than pretending it is active. Provider quota/rate-limit behavior is scoped by provider, key, or execution according to the router contract.

## Observability

The agent and Electron maintain logs appropriate to their boundary. Admin logs are protected, streamed through explicit IPC channels, and rotated. Operational claims must identify whether evidence came from automated tests, static review, manual browser inspection, installation, hardware, or an external service.
