// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActivityEvent, Agent, Issue } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueExecutionPanel } from "./IssueExecutionPanel";

const mockForIssue = vi.hoisted(() => vi.fn());
const mockRunsForIssue = vi.hoisted(() => vi.fn());
const mockRunEvents = vi.hoisted(() => vi.fn());

vi.mock("../api/activity", () => ({
  activityApi: {
    forIssue: mockForIssue,
    runsForIssue: mockRunsForIssue,
  },
}));

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: {
    events: mockRunEvents,
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.now();
const issue = { id: "issue-1", identifier: "PAP-1", title: "Execution task", status: "in_progress" } as Issue;
const agent = { id: "agent-1", name: "Coder" } as Agent;

function activity(): ActivityEvent[] {
  return [
    {
      id: "event-1",
      companyId: "company-1",
      actorType: "agent",
      actorId: "agent-1",
      action: "issue.updated",
      entityType: "issue",
      entityId: "issue-1",
      details: { status: "in_progress", _previous: { status: "todo" } },
      createdAt: new Date(now - 3 * 60 * 60 * 1000),
    },
    {
      id: "event-2",
      companyId: "company-1",
      actorType: "agent",
      actorId: "agent-1",
      action: "issue.updated",
      entityType: "issue",
      entityId: "issue-1",
      details: { status: "done", _previous: { status: "in_progress" } },
      createdAt: new Date(now - 60 * 60 * 1000),
    },
  ] as unknown as ActivityEvent[];
}

function runs() {
  return [
    {
      runId: "run-1",
      status: "succeeded",
      agentId: "agent-1",
      adapterType: "opencode_local",
      startedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      finishedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      invocationSource: "issue_assigned",
      usageJson: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 30 },
      resultJson: { costUsd: 0.12 },
      error: null,
      retryOfRunId: null,
    },
    {
      runId: "run-2",
      status: "failed",
      agentId: "agent-1",
      adapterType: "opencode_local",
      startedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      finishedAt: new Date(now - 90 * 60 * 1000).toISOString(),
      createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      invocationSource: "automation",
      usageJson: null,
      resultJson: null,
      error: "Adapter failed",
      retryOfRunId: "run-1",
    },
  ];
}

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  flushSync(() => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  return { container, root };
}

describe("IssueExecutionPanel", () => {
  beforeEach(() => {
    mockForIssue.mockReset();
    mockRunsForIssue.mockReset();
    mockRunEvents.mockReset();
    mockForIssue.mockResolvedValue(activity());
    mockRunsForIssue.mockResolvedValue(runs());
    mockRunEvents.mockResolvedValue([
      {
        id: 1,
        companyId: "company-1",
        runId: "run-1",
        agentId: "agent-1",
        seq: 1,
        eventType: "adapter.invoke",
        stream: null,
        level: "info",
        color: null,
        message: "adapter invocation",
        payload: null,
        createdAt: new Date(now - 2 * 60 * 60 * 1000),
      },
    ]);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders run summary, status/handoff events, and expands run events", async () => {
    const { container, root } = render(
      <IssueExecutionPanel
        issue={issue}
        agentMap={new Map([[agent.id, agent]])}
        userProfileMap={new Map()}
        currentUserId="user-1"
      />,
    );

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Succeeded");
      expect(container.textContent).toContain("Failed");
      expect(container.textContent).toContain("Coder");
      expect(container.textContent).toContain("150 tokens");
      expect(container.textContent).toContain("$0.12");
      expect(container.textContent).toContain("Status in_progress to done");
    });

    const eventsButtons = Array.from(container.querySelectorAll("button"))
      .filter((button) => button.textContent?.includes("Events"));
    const eventsButton = eventsButtons[eventsButtons.length - 1];
    expect(eventsButton).not.toBeUndefined();
    flushSync(() => {
      eventsButton!.click();
    });

    await vi.waitFor(() => {
      expect(mockRunEvents).toHaveBeenCalledWith("run-1", 0, 100);
      expect(container.textContent).toContain("adapter.invoke");
      expect(container.textContent).toContain("adapter invocation");
    });

    root.unmount();
  });

  it("shows an empty state when the task has no runs", async () => {
    mockRunsForIssue.mockResolvedValue([]);
    mockForIssue.mockResolvedValue([]);
    const { container, root } = render(
      <IssueExecutionPanel issue={issue} agentMap={new Map()} currentUserId="user-1" />,
    );

    await vi.waitFor(() => {
      expect(container.textContent).toContain("No runs recorded for this task yet.");
      expect(container.textContent).toContain("No status, assignment, or handoff changes recorded.");
    });

    root.unmount();
  });
});
