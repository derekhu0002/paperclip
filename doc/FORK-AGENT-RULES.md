# Fork agent rules

These rules describe behavior that exists only in this fork. They intentionally
live outside `skills/paperclip/SKILL.md`: that file is a capability-contract
source upstream, so editing it forces a regenerated contract (and a merge
conflict) on every upstream sync. Keeping fork guidance here leaves the upstream
skill byte-identical while agents still receive the rules through `AGENTS.md`.

## Assignment wakes are automatic

Creating or reassigning a `todo` issue to an agent enqueues an `issue_assigned`
wake. Do not call `POST /api/agents/{id}/heartbeat/invoke` or
`paperclipai heartbeat run` to start it. A manual empty wake can occupy the only
`maxConcurrentRuns` slot and delay the real assignment run; use a manual wake
only for an explicit on-demand check with no issue.

## Blockers resolve automatically

`PAPERCLIP_WAKE_REASON=issue_blockers_resolved` means every `blockedBy` issue
reached `done`. The dependent is moved from `blocked` to `todo` and its assignee
is woken. Do not wait for a human to release the next step. `cancelled` blockers
do not count as resolved.

## Idle watchdog

`PAPERCLIP_WAKE_REASON=idle_watchdog` means the company had no queued/running
run but had an assigned `todo` issue, so the server dispatched it. Treat it as a
recovery signal and investigate why the normal assignment/status wake did not
start the run.

## Plan-chain rule

Create planned work in `todo`, never in `backlog`. Model waiting as `blocked`
plus `blockedByIssueIds`, assigned to the owning Manager/Purple lane. The server
releases it when dependencies complete. Do not use an empty manual
`heartbeat/invoke` to start planned work.

## Graph evidence for project approvals

Do not hand-write the subgraph. The bundled helper reads the project's ArchGraph
document (`design/KG/SystemArchitecture.json`), picks a bounded focus
neighborhood, and adds a read-only `payload.graphContext` before posting the
approval:

```sh
node "$CLAUDE_SKILL_DIR/scripts/paperclip-approval-with-graph.mjs" \
  --title "Approve the identity-control change?" \
  --summary "The graph highlights the affected OAuth and telemetry nodes."
```

Use `--focus <id,id>` to name decision-specific nodes and `--graph <path>` when
the document is elsewhere. For a different graph framework, pass its
`paperclip.graph-context/v1` JSON with `--graph-context` (or a provider command
with `--graph-context-cmd`). The helper never writes a graph. With no graph
document or provider, use the normal approval endpoint; the human sees the
subgraph inside the existing approval card, and deeper questions belong in the
task thread with the Agent.
