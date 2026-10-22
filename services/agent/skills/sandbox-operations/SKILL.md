---
name: sandbox-operations
description: Execute local commands through the configured sandbox with secret hygiene and observable verification.
version: 1.0.0
triggers:
  - run command safely
  - use sandbox
  - inspect local system
tools:
  - shell
  - powershell
permissions:
  - shell
dependencies: []
---

Use the configured sandbox mode, strip secrets from child environments, reject
encoded or dynamically evaluated PowerShell, and verify exit code, output,
timeouts, and cleanup. UI state alone is not sandbox evidence.
