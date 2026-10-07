---
name: coding
description: For code generation, refactoring, debugging, code review.
version: 1.0.0
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

Use this skill when the user asks to generate, refactor, debug, or review code.

## Instructions
1. Understand the exact requirements of the code to be written.
2. If modifying existing code, read the file first using `view_file` to understand context.
3. When creating new files, use `write_to_file`. Ensure proper structure.
4. When refactoring or fixing bugs, use `replace_file_content` for surgical edits.
5. Consider testing the code if an execution environment is available.

## Safety Guidelines
- Avoid executing untrusted code or executing destructive system commands.
- Ensure all loops have termination conditions.

## Examples
- User: "fix the bug in calculator.py"
  Agent: uses `view_file` to inspect `calculator.py`, finds the bug, then uses `replace_file_content` to fix it.
- User: "implement a binary search function"
  Agent: uses `write_to_file` to create `binary_search.py` with the implementation.
