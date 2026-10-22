---
name: context-compression
description: Pack large HELIX context into compact recoverable blocks and retrieve exact originals when summaries are insufficient for a verified answer.
version: 1.0.0
triggers:
  - compress context
  - context compression
  - large output
  - compact context
  - retrieve context
  - context block
tools:
  - context_retrieve
permissions:
  - session_memory
dependencies: []
---

# Context Compression Skill

Use for large tool outputs, conversation tails, logs, code, and attachment notes handled by HELIX’s Context Compression Layer (CCL). The CCL keeps a compressed or spilled original and exposes a compact representation plus a block identifier for selective recovery.

## Procedure

1. Identify session, source label, block type, sensitivity, and whether exact wording or values may later be needed.
2. Keep content inline when it is under the configured threshold; pack only content that exceeds the budget or would crowd the model context.
3. Preserve source boundaries, ordering, metadata, and a stable `ccl:` block identifier.
4. Use the packed representation for navigation and planning, not as proof of every original detail.
5. Call `context_retrieve` for exact lines, code, numbers, citations, or any claim not supported by the packed representation.
6. On missing, expired, or corrupt blocks, report the evidence gap and do not reconstruct content from guesses.
7. Confirm cleanup, spill limits, and round-trip decompression for lifecycle or implementation changes.

## Safety and privacy

Treat compressed content as sensitive as its source. Do not log raw payloads, leak spill paths, or retain blocks beyond session policy. Distinguish lossless storage from lossy summarization and report truncation or unsupported modalities.

## Examples

- User: "Summarize the huge tool output but keep it auditable."
  Agent: packs the output, reports the block identifier and summary limits, and retrieves exact excerpts before citing them.
- User: "Use the previous compressed context."
  Agent: resolves the `ccl:` identifier in the active session, retrieves it, and reports if it is unavailable.
