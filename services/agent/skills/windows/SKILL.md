---
name: windows
description: Inspect and manage Windows applications, processes, services, files, settings, and diagnostics with explicit scope and verification.
version: 2.0.0
triggers:
  - open app
  - close app
  - process
  - system
  - settings
  - install
  - uninstall
  - task manager
tools:
  - run_command
  - manage_task
permissions:
  - system
  - execution
dependencies: []
---

# Windows OS Skill

Use for Windows application, process, service, file, settings, and diagnostic operations. Identify exact target, account, path, and desired state before changing anything.

## Procedure

1. Query current state: PID and executable path, service status, setting value, lock, or relevant log.
2. Choose the least-privileged operation and prefer user-scope changes.
3. Before install, uninstall, registry, service, firewall, or security changes, state impact and require clear authorization.
4. Execute one bounded operation, capture exit result, and re-query state.
5. If it fails, preserve diagnostics and do not escalate or retry destructively without new evidence.

## Safety

Never format drives, delete broad paths, disable security controls, or alter system policy without exact scope and explicit authorization. Do not stop a process by name when multiple unrelated instances may exist; identify PID and path. Never expose secrets or private command lines.

## Examples

- User: "Open Notepad."
  Agent: starts the requested application and verifies a matching process/window exists.
- User: "Close this app."
  Agent: identifies the intended process, warns about possible unsaved work, stops it, and verifies termination.
