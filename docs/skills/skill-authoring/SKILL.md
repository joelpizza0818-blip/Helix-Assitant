---
name: skill-authoring
description: Validate and register skills supplied by the user without granting implicit privileges.
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

# Skill authoring

Validate frontmatter, name, version, triggers, tools, permissions, and
instructions before registration. Keep user skills in the user data directory,
refresh the CLI suggestion cache after a successful registration, and do not
grant a skill capabilities that were not explicitly declared and approved.

Test discovery, malformed input, duplicate names, and the end-to-end
autocomplete path before reporting success.
