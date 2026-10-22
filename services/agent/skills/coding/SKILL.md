---
name: coding
description: Generate, modify, debug, refactor, review, and test source code while preserving existing contracts and proving requested behavior.
version: 2.0.0
triggers:
  - code
  - program
  - function
  - class
  - debug
  - refactor
  - fix bug
  - implement
  - develop
tools:
  - execute_code
  - view_file
  - write_to_file
  - replace_file_content
permissions:
  - filesystem
  - execution
dependencies: []
---

# Coding Skill

Use for implementation, debugging, refactoring, reviews, tests, and build failures. Do not silently expand scope, rewrite unrelated modules, or treat generated output as source of truth.

## Procedure

1. Identify behavior, affected boundary, runtime, acceptance criteria, and risk.
2. Inspect repository structure, source, tests, configuration, and existing changes before editing.
3. Trace cross-boundary behavior through input, validation, state, transport, persistence, rendering, and errors.
4. Make the smallest coherent patch using the existing architecture and contracts.
5. Add or update focused tests for success, failure, and boundary behavior.
6. Run relevant typecheck, lint, tests, build, or runtime probe; do not claim success from inspection alone.
7. Review the diff for unrelated files, secrets, debug code, public API changes, and regressions.

## Rules

Preserve backwards compatibility unless a breaking change is requested. Validate external input at boundaries, keep errors observable, avoid unnecessary dependencies, and consider cleanup, cancellation, concurrency, privacy, and security. Never place credentials or tokens in code, logs, tests, or output.

## Examples

- User: "Fix the timeout in this API."
  Agent: reproduces it, traces the request boundary, applies a focused fix, adds a regression test, and verifies timeout and success paths.
- User: "Review this change."
  Agent: inspects the diff and tests, reports concrete findings by severity, and avoids style-only noise.
