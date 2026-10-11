---
name: github
description: For GitHub operations - PRs, issues, repos, commits.
version: 1.0.0
triggers:
  - pull request
  - PR
  - issue
  - commit
  - repository
  - merge
  - branch
  - github
tools:
  - run_command
  - search_web
permissions:
  - network
  - execution
dependencies: []
---

# GitHub Skill

Use this skill for source control operations and interacting with GitHub repositories.

## Instructions
1. Determine if the operation requires local Git commands or remote GitHub API/CLI commands.
2. For local operations, use `run_command` with standard `git` CLI (e.g., `git status`, `git commit`).
3. For remote operations (PRs, Issues), use the configured GitHub web/API integration. Do not assume that GitHub CLI is installed in the distributed agent.
4. Always verify branch status before committing or merging.

## Safety Guidelines
- Do not force push to shared branches (like `main` or `master`).
- Review diffs before committing code.
- Avoid exposing tokens in commands or outputs.

## Examples
- User: "create a new PR for this branch"
  Agent: uses the configured GitHub web/API integration and verifies the resulting PR URL.
- User: "check my git status"
  Agent: uses `run_command` to run `git status`.
