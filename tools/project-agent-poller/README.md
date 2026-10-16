# Project Agent Poller

A small host-side poller that activates a project's Paperclip agent when that
project has new GitHub issue work — **without interrupting a running session**.

This is the "B2" trigger design:

```
GitHub issues  ──►  poller (this script, every N minutes)
                       │  new + unhandled issue?
                       │  project session idle?   ── no ─► skip
                       ▼ yes
                    create a carrier Paperclip issue assigned to the
                    project's agent  ──►  agent wakes and works
```

## What it does / does NOT do

- **Does**: watch GitHub issues per project, decide *when* to wake the agent.
- **Does NOT** touch any agent's `AGENTS.md`, skills, or any global memory.
  The task prompt is the **carrier issue body** created at wake time (per task).
- **Does NOT** serialize by itself beyond the "is a session running?" gate;
  the project owns its own single-session / single-writer rules.

## Activity gate (bias to BUSY)

Before waking, the poller checks whether the project already has an active
session. It treats the project as BUSY (and skips) if **any** of:

1. **OpenCode** has a session for the project directory with either an
   unfinished assistant message (`$.time.completed` missing) or a running tool
   part (`$.state.status = "running"`), updated within `busyWindowMinutes`.
   This survives long tool calls / long turns, so it does not rely on a short
   timeout. It is intentionally biased to BUSY: a false "busy" only delays a
   wake; a false "idle" would cause concurrent writes.
2. **Paperclip** reports a `queued`/`running` heartbeat run for the agent.
3. Either check **errors** (fail-closed → BUSY).

## Prerequisites

- Node.js on PATH.
- The `gh` CLI, authenticated (or `GH_TOKEN`/`GITHUB_TOKEN` in the environment).
- The OpenCode CLI (`opencode`) on PATH (for the session-activity check).
- A Paperclip **board API token** (env `PAPERCLIP_BOARD_TOKEN`).
- GitHub **labels** per project (routing) plus the shared done label, e.g.:
  ```sh
  gh label create pm:paperclip --repo derekhu0002/paperclip --color 1D76DB -d "Routed to the paperclip PM agent"
  gh label create pm:my-army   --repo derekhu0002/my-army   --color 1D76DB -d "Routed to the my-army PM agent"
  gh label create pm:done      --repo derekhu0002/paperclip --color 0E8A16 -d "Handled by the PM agent"
  gh label create pm:done      --repo derekhu0002/my-army   --color 0E8A16 -d "Handled by the PM agent"
  ```

## Configure

Copy `projects.example.json` to `projects.json` and edit:

- `paperclipBaseUrl`, `companyId`
- `busyWindowMinutes` (default 15)
- `projects[]`: `project`, `repo`, `dir`, `agentId`, `projectId`, `routingLabel`

Do **not** put the board token in the file; set `PAPERCLIP_BOARD_TOKEN`.

## Run

```sh
# one pass (good for testing)
PAPERCLIP_BOARD_TOKEN=... node poller.mjs --config ./projects.json
```

Environment overrides: `POLLER_CONFIG`, `POLLER_BUSY_WINDOW_MINUTES`,
`PAPERCLIP_API_BASE`, `PAPERCLIP_BOARD_TOKEN`, `OPENCODE_BIN`.

## Schedule

```powershell
.\register-scheduled-task.ps1 -BoardToken <board-token>
# remove later:
# Unregister-ScheduledTask -TaskName PaperclipProjectAgentPoller -Confirm:$false
```

## Dedupe / lifecycle

- Routing: an open issue with the project's routing label is a candidate.
- Done: the agent marks the GitHub issue `pm:done` (or closes it) when finished;
  issues carrying `pm:done` are ignored.
- Serial: only **one** carrier is created per project per pass, and only when
  idle. If a run fails and leaves the issue unhandled, the next idle pass
  retriggers it (idempotent by design).
