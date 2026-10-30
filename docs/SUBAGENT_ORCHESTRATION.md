# HELIX subagent orchestration

## Status and scope

The desktop subagent workspace and core orchestration are implemented. The
backend test suite, Electron/renderer typecheck, and desktop test suite have
passed for this change. A live provider/Electron visual test has not been run;
do not treat visual polish or real-provider collaboration as verified.

## Persistent profiles

`services/agent/core/agent_profiles.py` owns the local profile catalog at
`<settings directory>/subagents/profiles.json`. It seeds four defaults:

| Profile | Specialty | Role | Color |
|---|---|---|---|
| Harvey | Coordination and planning | `planning` | HELIX orange |
| Joel | Software engineering and architecture | `coding` | HELIX teal |
| Flowbot | Automation, browser, repeatable workflows | `automation` | HELIX lavender |
| Eliot | Research, critical analysis, verification | `research` | HELIX green |

The catalog contains descriptions, capability labels, optional strict model
routes, and a bounded promotion history. It contains no API credentials.
Model-created profiles are capped at 100; capability lists and descriptions are
validated. `DelegateTaskTool` requires a saved `agent_id` or a `new_agent`
definition when the persistent profile catalog is available.
The desktop workspace refreshes the profile catalog on agent lifecycle events,
so newly created profiles appear without reopening the panel. Profile color and
role are shown in the roster.

## Runtime and collaboration

`AgentManager` associates each delegated task with a profile, keeps task
lifecycle records, and serializes work assigned to the same profile. Profile
conversations use stable in-process conversation IDs, so messages from direct
chat, delegated work, and peer turns share context during the running Desktop
session.

`message_subagent` sends a separate model request to another profile and returns
the reply to the sender. The main agent can also use this tool. Peer requests
have a depth limit of two to prevent unbounded cycles. Direct user-to-agent
requests use `CHAT_SUBAGENT` over the existing Desktop/Python WebSocket request
bridge. Provider outages and timeouts are returned as actionable, allowlisted
messages; raw provider exceptions, model names, and credentials are not exposed
to the renderer. Explicit model routes remain strict, so a temporary outage on
a pinned model asks the user to retry or choose another route.

Desktop request deadlines begin when a request is queued and retain their
remaining time across reconnects. If a sent request expires, Electron sends
`CANCEL_REQUEST` so the Python WebSocket handler cancels the matching request
task. Direct subagent chat allows up to 20 minutes in Desktop and the Mobile
relay path. Failed task updates carry a sanitized explanation that the Task
Manager displays; raw exception text is not forwarded.

Each profile gets a separate `UserMemoryManager` file under
`<settings directory>/subagents/memories/<profile_id>.json`. `manage_memory`
operates on the active profile scope during a subagent turn. Memory remains
local, editable from the workspace, limited to 100 entries of at most 500
characters, and rejects credential-like values. The model is instructed to
save only durable, useful information rather than ordinary messages or
one-off task details.

`promote_subagent` lets the main agent add a bounded work description and
declarative capability labels. A promotion is recorded and sent to the renderer
and operating-system notification. Promotion does not grant new tools or
permissions.

## Shared-resource queues

`ReActLoop` keeps task-scoped resource leases for the duration of a model
request, and for the full lifetime of a planned workflow task. Cancellation
releases leases; nested delegation and peer messaging temporarily release the
parent's leases so the child request can make progress. `Orchestrator` releases
planned-workflow leases on task completion.

Current resource-name classification:

- Browser: names containing `browser`, or starting with `web.` / `playwright.`
- Desktop: `computer.*`, `keyboard.*`, `mouse.*`, `screenshot_tool`, or
  `screen_capture`
- Workspace: shell tools and names containing `file`, `workspace`, `directory`,
  `terminal`, `shell`, `powershell`, or `cmd`

Wait/acquire events update task progress and the subagent panel. New tool
families should be classified before they can operate on one of these shared
resources; generic MCP/plugin tools are not automatically assigned a resource
unless their names match a rule above.

## Model and key routing

Profiles default to normal model-router selection. A user can optionally pin a
profile to one provider, model, and key slot using the key control in the
subagent panel. The UI shows configured provider/model names and slot numbers,
never key values. An explicit assignment is strict: the router does not fall
back to another provider, model, or slot if that route is unavailable.
The routing view visually pairs configured key slots with profiles; a key slot
can be assigned to multiple profiles.
`ReActLoop` copies `TaskRequirements` per request so one profile's route or
vision needs cannot mutate another role's shared configuration.

## Desktop UI and request contract

The floating chat opens a dedicated Electron window at `#agents`. The window
uses the restricted preload bridge and exposes:

- All, invoked, and not-yet-invoked profile lists.
- Per-profile task status/progress, queue state, and cancellation.
- Direct turn-based chat.
- Private memory review, add, edit, and delete.
- Optional provider/model/key-slot assignment with a visual connection to
  invoked and not-invoked profiles.

Direct-chat activity is tracked per profile in the renderer: a request to one
profile does not mark other profiles as responding or disable their chat input.
Different profiles continue to execute concurrently, while requests to the same
profile remain serialized. Status refreshes share an in-flight request, and the
backend fetches task progress for all returned subagents in one locked snapshot.

The Python request handler provides `GET_SUBAGENT_PROFILES`,
`GET_SUBAGENT_STATUS`, `GET_SUBAGENT_ROUTING_OPTIONS`, `SET_SUBAGENT_ROUTE`,
`CHAT_SUBAGENT`, and the four `*_SUBAGENT_MEMORY` operations. Renderer lifecycle
events pass through `safe_subagent_lifecycle_payload`; prompts, model replies,
memory contents, and credentials are not broadcast as lifecycle metadata.

## Known limitations and next work

1. Conversation turns are retained in `ContextManager` only for the current
   agent process. Profile memories persist across restarts, but full direct-chat
   transcripts do not.
2. The workspace window has typechecked, but has not yet been visually reviewed
   in a running Electron session.
3. Tests use fake model loops; live-provider tool selection, chained peer
   conversations, and profile creation through a real model remain to be
   exercised.
4. New profile proposals are generated by the model currently making the
   delegation request; the implementation does not force that request through
   a local-only model.
5. Resource classification is intentionally conservative and name-based. Add
   explicit resource metadata for new browser/desktop/workspace MCP or plugin
   tools rather than relying on naming conventions.
6. Promotion changes profile descriptions and capability labels only. Any
   future capability-to-tool mapping must retain existing permission checks and
   must not silently elevate sensitive permissions.

## Verification performed

- `python -m pytest services/agent/tests -q`: 477 passed, 3 skipped.
- `npm run typecheck` from `apps/desktop`: passed.
- `npm test` from `apps/desktop`: 42 passed.
- `git diff --check`: passed; Git emitted only existing LF/CRLF conversion
  warnings.
