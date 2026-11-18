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

## Plan-chain rule

`backlog` is the ownership-undecided basket: file a requirement there while its
owner (person or agent) is still undecided. Planned, ready work belongs in
`todo` with an agent assignee — promoting an issue out of `backlog` into
`todo`, `in_progress`, or `in_review` requires one. Model waiting as `blocked`
plus `blockedByIssueIds`, assigned to the owning Manager/Purple lane. The server
releases it when dependencies complete. Do not use an empty manual
`heartbeat/invoke` to start planned work.

## Board API keys stay with the operator

A `board` API key authenticates as a human board user, not as an agent: it
inherits that person's full permissions, is not company-scoped, and outlives the
run. Keep it with the one named operator the human assigned.

- Use the run-scoped `PAPERCLIP_API_KEY` for normal issue, comment, document and
  work-product operations. Use a board key only for a configuration action the
  run credential cannot perform.
- Never copy a board key into another Agent, a child process environment, an
  issue, a comment, a document, a repository file, or a log. An Agent that needs
  an elevated action asks the operator, who performs it.
- Allowed with the board key: Agent, permission, skill, environment, and app
  connection changes inside the operator's own company. Requires the human's
  explicit approval: deleting or stopping an Agent, creating or revoking any API
  key, company-strategy configuration, and anything cross-company.
- `GET /api/agents/me` returns `401 Agent authentication required` for a board
  key by design. Probe with `GET /api/cli-auth/me` (expect `200`) instead of
  treating that 401 as a broken credential.

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
