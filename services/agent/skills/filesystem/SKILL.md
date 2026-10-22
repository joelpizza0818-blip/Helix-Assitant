---
name: filesystem
description: Safely inspect, create, edit, move, copy, rename, and delete files or directories with verified paths and recoverable behavior.
version: 2.0.0
triggers:
  - file
  - folder
  - directory
  - create file
  - delete
  - move
  - copy
  - rename
  - read file
tools:
  - view_file
  - write_to_file
  - replace_file_content
  - run_command
permissions:
  - filesystem
dependencies: []
---

# File System Skill

Use for local file and directory operations. Resolve exact absolute paths before mutation and preserve unrelated user data.

## Procedure

1. Check source and destination existence, type, size, permissions, and relevant contents.
2. Classify the operation as read-only, reversible, overwriting, or destructive.
3. For edits, preserve encoding and line endings and make the smallest change.
4. For move/copy, verify destination scope and collisions before acting.
5. For deletion, prefer a recoverable trash/archive; otherwise verify the exact target immediately before removal.
6. Re-scan source and destination and report observable results.

## Safety

Never use unresolved broad wildcards or variables for destructive operations. Do not overwrite existing files without checking ownership. Do not modify system-critical paths outside the requested workspace. Report exact affected paths.

## Examples

- User: "Move this folder to Documents."
  Agent: resolves both paths, checks destination absence, moves it, and verifies both sides.
- User: "Delete the old logs."
  Agent: enumerates exact candidates, confirms scope, removes only those files, and reports recovery status.
