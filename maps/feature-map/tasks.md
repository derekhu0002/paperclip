---
navigation: {"section":"Tasks and conversations","sectionOrder":20,"order":10}
---

# Task creation and lifecycle

People create, assign, organize, discuss, and finish tasks. A task retains its owner, project, priority, history, and outputs as it moves through the work lifecycle.

Implementation: [new task](../../ui/src/components/NewIssueDialog.tsx), [task list](../../ui/src/pages/Issues.tsx), [task detail](../../ui/src/pages/IssueDetail.tsx).

Agent access: [companion](../agent-access-map/tasks.md).

## Sub-features

- `create`: capture a title/request with the intended agent, project, and attachments.
- `organize`: filter, sort, group, and navigate tasks without losing the selected context.
- `execution-view`: switch the task collection to a single agent-grouped execution timeline with a selectable 24h/7d/30d window and 1x/2x/4x/8x zoom; each task is one rectangle from creation to completion, segmented into backlog/blocked (neutral), queue (yellow), execution (green), and paused/waiting (neutral), and each agent group can contain multiple task lanes; delegation/assignment handoffs are listed as text below the chart. Open the per-task Execution tab (classic) or More > View execution (chat shell) for the run chain and expandable run events.
- `properties`: change status, priority, assignee, project, and relationships where authorized.
- `discussion`: persist comments, references, and files on the task.
- `completion`: distinguish backlog, active work, review, blocked, done, and cancelled outcomes.

## How to get to it (user POV)

### `new-task`

Use New task from the global launcher, task list, or project task view.

### `task-list`

Open `/issues` or a project鈥檚 Issues view; legacy `/tasks` links redirect.

### `task-detail`

Open `/issues/:issueId` from a row, mention, or direct link.

## Driving it with Playwright and the Paperclip CLI

Preconditions: follow the [baseline](./README.md#before-driving-a-journey). Use a
disposable project. Persistence checks can assign work to Me or leave it
unassigned; execution checks additionally need an invokable test agent. Record
whether a real or simulated harness handles execution.

### `new-task`

Automated: [creation dialog](../../ui/src/components/NewIssueDialog.test.tsx) is component coverage with mocked requests.

Manual: Create a uniquely named task with an agent and project. Open its resulting link and reload. Confirm text, attachment, assignment, and project persisted, and verify execution started only when the task and agent are eligible.

Creation is request-first: enter **Describe a task鈥?*, choose the assignee and
project, and submit **Create task**. A standalone title field is not always shown.
Use a human/unassigned task to verify persistence without invoking a model.

### `task-list`

Automated: [task-list helpers](../../ui/src/pages/Issues.test.tsx) cover search URLs, pagination, deduplication, and presentation constants. [Execution timeline](../../ui/src/components/IssueExecutionTimeline.test.tsx) covers task/agent lanes, run bars, event markers, issueIds scoping, and the empty window; [task execution panel](../../ui/src/components/IssueExecutionPanel.test.tsx) covers run summary, status/handoff events, expandable run events, and an empty task; [task collection](../../ui/src/components/IssuesList.test.tsx) covers the view switch and restored lane/window. The suite does not render the page or exercise filtering, grouping, opening a task, and returning; those interactions still need a running-browser check.

Manual: Seed human-created, agent-created, scheduled routine, human-initiated chat-channel, and creator-less tasks. Confirm automation is hidden by default, **show agent-created tasks** reveals it, reload preserves the choice, and Clear filters hides it again. Verify list and board search with automation newer than the human results, and expand contextual ancestors/subtasks without promoting unrelated automated roots. Repeat in project task lists. Agent profiles and task-detail subtasks retain complete history.

Manual: Filter by status and assignee, change grouping/sort, open a task, and return. Verify the correct records and selected view survive navigation and reload. Include an empty result and a failed request.

Manual: Switch to Execution, verify agent groups and their task lanes render, change the 24h/7d/30d window, and zoom from 1x to 8x with horizontal scrolling. For a task with runs, verify one rectangle from creation to completion with yellow queue, green execution, and neutral paused/waiting segments; click it to open the task. Verify the text handoff list below the chart, an empty agent window, and a failed timeline request.

Manual: Open a task detail. In classic mode use the Execution tab; in chat-shell mode use More > View execution. Verify the run summary, status/handoff list, run error, and expandable run events; close and reopen the view, and confirm it follows live runs.

### `task-detail`

Automated: [task detail](../../ui/src/pages/IssueDetail.test.tsx) covers component behavior, while [issue service](../../server/src/__tests__/issues-service.test.ts) covers server contracts.

Manual: For a disposable task owned by a legacy agent, have its current run
assign the task to a human with status In review. Verify that assignment and
status persist, that the current run finishes without `issue_reassigned`, and
that slow workspace restoration does not turn the task Blocked. Try a later edit
from the outgoing run and verify rejection. Repeat a board
reassignment and confirm that the outgoing run still stops.

Manual: Add a comment and edit authorized properties. Reload and verify history, actor, and values. Complete a disposable task and inspect its deliverable; reopen through an available action and confirm the next execution follows current policy.

## Gotchas

- Priority remains an API field, but ordinary priority UI editing is hidden.

- A status label alone does not prove that the requested work exists.
- Single-assignee and atomic checkout rules still apply when tasks are created from different hosts.
- Use [coordination](./task-coordination.md), [steering](./steering.md), and [documents](./documents-artifacts.md) for their distinct workflows.

### Documentation scope: Tasks, conversations, and attention

Recipes cover the main task/conversation/attention workflows. Full shell, permission, attachment, long-thread, and concurrency permutations remain to be enumerated.

