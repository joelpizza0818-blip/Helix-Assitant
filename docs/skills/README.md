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
- `browser`: web browsing and verified page interactions.
- `browser-companion`: paired browser control in a dedicated HELIX tab; other tabs are not shared, but the normal browser profile and cookies are used.
- `coding`: code changes, debugging, and verification.
- `context-compression`: preserve important context while reducing token use.
- `data-analysis`: reproducible analysis of structured data.
- `documents`: faithful reading and transformation of user-provided documents.
- `filesystem`: scoped filesystem operations and verification.
- `github`: repository, issue, pull request, and release workflows.
- `research`: sourced research with explicit uncertainty.
- `skill-authoring`: validation and registration of user-provided skills.
- `sandbox-operations`: safe shell execution and sandbox-aware verification.
- `voice-companion`: response speech, fallback behavior, and privacy boundaries.
- `windows`: scoped Windows diagnostics and application management.

The runtime source remains authoritative. Update this registry when a default
skill's behavior changes, and record automated versus manual evidence in the
release notes. `docs/skills` contains selected companion documents; the complete
built-in runtime set is under `services/agent/skills`.
