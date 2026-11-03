# Done Memory Gate

Paperclip plugin that makes agents leave machine-verifiable memory evidence before a task stays `done`.

## Why

Paperclip's own `done` transition only records status, activity, and dependency release. Nothing
requires an agent to write down what the task taught. This plugin adds that requirement without
changing core routes: it subscribes to `issue.updated` and checks the memory evidence after the
transition commits.

## Contract

An issue passes the gate when either exists:

1. A comment line with a non-empty marker:
   `memory-capture: <argo element id | document key | url>`
2. An issue document with key `memory` whose body has at least 200 non-whitespace characters.

The plugin also ships a managed company skill `task-memory-capture` that describes the contract.

## Behavior

- Gated only when: the event is a real transition into `done`, the actor is an agent, the issue has
  an `assigneeAgentId`, and the issue is not a plugin-operation issue.
- Evidence missing and the issue blocks no dependents: revert to `in_progress`, post the contract
  comment, and request a wakeup for the assignee.
- Evidence missing but the issue blocks a dependent: keep `done` and post a reminder comment.
  Reverting would race the dependency auto-release that already ran for this transition.
- After 3 revert attempts on the same issue, the gate stops and leaves a final warning comment.
  This prevents a done/revert loop.
- The gate's own reminder comments are excluded from evidence scanning.

## Install

```sh
pnpm --filter @paperclipai/plugin-done-memory-gate build
paperclipai plugin install packages/plugins/plugin-done-memory-gate
```

The plugin is worker-only (no UI bundle). It is not part of the self-hosted auto-install list, so it
stays opt-in until an operator installs it or adds `done-memory-gate` to `plugins.autoInstall`.

## Test

```sh
pnpm --filter @paperclipai/plugin-done-memory-gate test
pnpm --filter @paperclipai/plugin-done-memory-gate typecheck
```
