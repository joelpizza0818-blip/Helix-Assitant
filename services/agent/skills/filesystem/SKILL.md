---
name: filesystem
description: For file system operations - create, read, write, move, delete files/dirs.
version: 1.0.0
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

Use this skill to perform operations on the local file system.

## Instructions
1. Identify the files or directories to act upon. Use absolute paths when possible.
2. For reading, use `view_file`.
3. For creating or writing, use `write_to_file`.
4. For editing existing files, use `replace_file_content`.
5. For complex directory operations (move, copy, delete), use `run_command` with standard PowerShell utilities.

## Safety Guidelines
- Double-check paths before performing destructive operations like delete or overwrite.
- Do not modify system-critical files outside of user workspaces.

## Examples
- User: "create a folder named 'assets' and put a readme in it"
  Agent: uses `run_command` to `mkdir assets`, then `write_to_file` to create `assets/README.md`.
- User: "delete the old logs"
  Agent: uses `run_command` to run `Remove-Item -Path ./logs/*.log`.
