# HELIX default skills

This directory is the reviewable companion registry for the built-in skills in
`services/agent/skills`. The runtime loads the executable `SKILL.md` files from
the agent directory; these copies document the supported behavior shipped with
the product.

Each skill must declare its scope, tools, permissions, failure behavior, and a
verification rule. User-created skills are loaded from the user's HELIX data
directory and are never trusted merely because they contain a skill name.

## Default set

- `agent-orchestration`: bounded planning, delegation, recovery, and evidence.
- `context-compression`: preserve important context while reducing token use.
- `browser-companion`: paired browser control with explicit window ownership.
- `voice-companion`: response speech, fallback behavior, and privacy boundaries.
- `sandbox-operations`: safe shell execution and sandbox-aware verification.
- `skill-authoring`: validation and registration of user-provided skills.

The runtime source remains authoritative. Update this registry when a default
skill's behavior changes, and record automated versus manual evidence in the
release notes.
