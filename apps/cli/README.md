# HELIX CLI

Interactive terminal client for the local HELIX agent.

```powershell
npx helix-assistant-cli
```

The CLI requires a reachable HELIX agent and a configured model provider for
AI-backed requests.

## Subagents

- `/subagents` displays the ASCII profile/status panel.
- `/subagents chat <profile_id> <message>` sends a direct message to a profile.

## Browser snapshots

- `/browser open <url>` asks the agent to open a page.
- `/browser live on` enables the ASCII snapshot viewer; `/browser live off`
  disables it.

Frames are JPEG snapshots emitted after successful browser actions, not a
continuous video stream. Browser-frame routing is limited to the requesting
conversation.
