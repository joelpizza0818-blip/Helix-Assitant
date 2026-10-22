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

# Sandbox operations

Use the configured sandbox mode and preserve the permission manager's
confirmation requirements. Strip secrets from child environments, reject
encoded or dynamically evaluated PowerShell, and keep helper consoles hidden
when execution is non-interactive. Verify exit code, output, timeout, and
cleanup; never infer sandbox isolation from a UI toggle alone.
