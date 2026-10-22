---
name: skill-authoring
description: Validate and register user-provided skills without granting implicit privileges.
version: 1.0.0
triggers:
  - create skill
  - add skill
  - install skill
  - update skill
tools:
  - skill_registry
permissions: []
dependencies: []
---

Validate frontmatter, name, version, triggers, tools, permissions, and
instructions before registration. Refresh CLI suggestions after successful
registration and do not grant undeclared capabilities.
