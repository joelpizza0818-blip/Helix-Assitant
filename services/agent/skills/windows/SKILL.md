---
name: windows
description: For Windows OS operations - process management, app control, system settings.
version: 1.0.0
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

Use this skill to interact with the underlying Windows Operating System.

## Instructions
1. Understand the user's intent regarding system state or applications.
2. Use PowerShell commands via `run_command` to query or modify system state.
3. Manage background processes via `manage_task` or standard Windows utilities (`Stop-Process`, etc.).
4. Confirm successful execution by checking command outputs or system state.

## Safety Guidelines
- Be extremely cautious with commands that modify system settings or delete files.
- Never propose destructive commands like formatting drives or modifying the registry without explicit confirmation.
- Only interact with the user's intended apps/processes.

## Examples
- User: "open notepad"
  Agent: uses `run_command` to execute `Start-Process notepad`.
- User: "kill the chrome process"
  Agent: uses `run_command` to execute `Stop-Process -Name chrome -Force`.
