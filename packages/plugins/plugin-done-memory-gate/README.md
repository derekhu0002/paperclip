# Done Memory Gate

Paperclip plugin that checks a finished agent conversation for graph memory and creates a follow-up
task when the memory is missing.

## Why

Agent rules already ask an agent to write memory at milestones. They do not guarantee it happened.
This plugin adds an end-of-conversation check without changing core routes: it subscribes to
`issue.updated`, and when an agent closes an issue as `done` it verifies that the conversation left a
memory element in the project's ARGO/ArchGraph intent graph.

## Contract

The only accepted proof is a comment line that names a graph element:

```
memory-capture: argo:<graphKey>#<elementId>
```

for example
`memory-capture: argo:design/KG/SystemArchitecture.json#paperclip-session-2026-11-03`.

A general comment, a URL, or an issue document does not satisfy the default strict mode. An operator
can opt into the document fallback with `allowIssueDocumentFallback: true`; even then the graph
reference is preferred.

The plugin does not verify that the element exists in Neo4j. It enforces the reference format; the
agent rules require the actual write. Reaching an ARGO endpoint for existence checks would need an
operator-configured endpoint and is intentionally out of scope for now.

## Behavior

- Runs only when: the event is a real transition into `done`, the actor is an agent, the issue has an
  `assigneeAgentId`, and the issue is not a plugin-operation issue.
- Graph memory present: nothing happens.
- Graph memory missing: the issue stays `done`; the plugin creates one follow-up task
  (`记录任务记忆：<identifier>`) assigned to the same agent, in the same project, as a child of the
  finished issue. The assignment wakes the agent, which then writes the memory element.
- No comment is posted on the finished issue: the follow-up task is the wake mechanism, and
  `parentId`/`originId` already link it back to the conversation.
- One reminder per finished issue: the plugin records state after the first follow-up.
- The check never changes issue status, so dependency auto-release is unaffected.
- Intermediate runs are not checked; only the final `done` transition is.

## Install

```sh
pnpm --filter @paperclipai/plugin-done-memory-gate build
paperclipai plugin install packages/plugins/plugin-done-memory-gate
```

The plugin is worker-only (no UI bundle) and opt-in; it is not part of the self-hosted auto-install
list.

## Test

```sh
pnpm --filter @paperclipai/plugin-done-memory-gate test
pnpm --filter @paperclipai/plugin-done-memory-gate typecheck
```
