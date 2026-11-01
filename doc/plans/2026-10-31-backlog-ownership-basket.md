# Backlog as an ownership-undecided requirement basket

Status: agreed, not implemented (recorded 2026-10-31).

## Goal

Let people and agents file a requirement into `backlog` before its owner is
decided (one human, several humans, or one agent). `todo` keeps meaning
"owned and actionable".

## Current blocker (both are fork-specific)

1. `AGENTS.md` rule 7 and the plan-chain rule in `doc/FORK-AGENT-RULES.md` say
   planned work must be created in `todo`, never `backlog`.
2. The fork's agent-assignee guard rejects every agent-created issue without an
   agent assignee, regardless of status
   (`server/src/routes/issues.ts`, `sanitizeIssueCreateAttribution` plus the two
   post-authorization checks).

Upstream facts that already support the basket: `backlog` is a first-class
status and the schema default; it is excluded from dispatch
(`server/src/services/heartbeat.ts` `issueStatus !== "backlog"`).

## Planned change (minimal)

1. Agent-assignee guard: skip the 422 when the create payload's status is
   `backlog`. Keep rejecting a board-user assignee.
2. New invariant: `backlog -> todo` promotion requires an agent assignee, so an
   unowned `todo` (the deadlock this guard exists to prevent) cannot reappear.
3. Docs: redefine `backlog` as the unrefined/ownership-undecided basket and
   `todo`/`blocked` as owned work; keep assignment wake scoped to `todo`.
4. Optional later: `pm:backlog` label support in `tools/project-agent-poller`
   and a triage action that promotes backlog items to `todo` with an owner.

## Risk

Backlog items wake nobody. Without a triage routine the basket rots. The guard
should therefore be narrowed, not removed: unowned is allowed only in `backlog`.
