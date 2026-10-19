// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Issue, WorkTimelineResult } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IssueExecutionTimeline } from "./IssueExecutionTimeline";

const mockGet = vi.hoisted(() => vi.fn());

vi.mock("../api/workTimeline", () => ({
  workTimelineApi: { get: mockGet },
}));

vi.mock("@/lib/router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

vi.mock("./StatusIcon", () => ({
  StatusIcon: ({ status }: { status: string }) => <span data-testid="status-icon">{status}</span>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.now();
const issue = {
  id: "issue-1",
  identifier: "PAP-1",
  title: "Execution task",
  status: "in_progress",
  createdAt: new Date(now - 4 * 60 * 60 * 1000),
  updatedAt: new Date(now - 30 * 60 * 1000),
} as Issue;

function result(overrides: Partial<WorkTimelineResult> = {}): WorkTimelineResult {
  return {
    actors: [
      { id: "agent:agent-1", type: "agent", name: "Coder" },
      { id: "user:user-1", type: "user", name: "Reviewer" },
    ],
    spans: [{
      actorId: "agent:agent-1",
      laneHint: "assignment",
      runId: "run-1",
      issueId: "issue-1",
      issueIdentifier: "PAP-1",
      issueTitle: "Execution task",
      start: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      end: new Date(now - 60 * 60 * 1000).toISOString(),
      status: "succeeded",
      invocationSource: "issue_assigned",
      usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 30, totalTokens: 150 },
      costUsd: 0.12,
    }],
    events: [
      { actorId: "agent:agent-1", kind: "commented", issueId: "issue-1", at: new Date(now - 90 * 60 * 1000).toISOString() },
      { actorId: "user:user-1", kind: "approved", issueId: "issue-1", at: new Date(now - 80 * 60 * 1000).toISOString() },
    ],
    edges: [{
      fromActorId: "agent:agent-1",
      toActorId: "user:user-1",
      issueId: "issue-1",
      at: new Date(now - 90 * 60 * 1000).toISOString(),
      kind: "delegation",
    }],
    pagination: { limit: 200, offset: 0, totalIssues: 1, hasMore: false },
    window: {
      from: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      to: new Date(now).toISOString(),
      capped: false,
    },
    ...overrides,
  };
}

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider>{node}</TooltipProvider>
      </QueryClientProvider>,
    );
  });
  return { container, root };
}

describe("IssueExecutionTimeline", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue(result());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders task lanes, run bars, event markers, and passes issueIds to the timeline API", async () => {
    const { container, root } = render(
      <IssueExecutionTimeline
        companyId="company-1"
        issues={[issue]}
        issueIds={["issue-1"]}
        lane="task"
        timeWindow="24h"
      />,
    );

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Execution task");
      expect(container.textContent).toContain("PAP-1");
      expect(container.textContent).toContain("1 runs / last 24h");
      expect(container.querySelector('a[href="/issues/issue-1"]')).not.toBeNull();
      expect(container.querySelector('[aria-label^="Task span"]')).not.toBeNull();
      expect(container.querySelector("svg circle")).not.toBeNull();
      expect(container.querySelector("svg title")?.textContent).toContain("Delegation");
      expect(container.querySelectorAll("[aria-label^='Commented by']").length).toBe(1);
      expect(container.querySelectorAll("[aria-label^='Approved by']").length).toBe(1);
    });

    expect(mockGet).toHaveBeenCalledWith("company-1", expect.objectContaining({
      issueIds: ["issue-1"],
      limit: 200,
    }));
    expect(mockGet.mock.calls[0]?.[1]?.from).toEqual(expect.any(String));
    expect(mockGet.mock.calls[0]?.[1]?.to).toEqual(expect.any(String));

    root.unmount();
  });

  it("renders agent lanes when the lane is agent", async () => {
    const { container, root } = render(
      <IssueExecutionTimeline
        companyId="company-1"
        issues={[issue]}
        issueIds={["issue-1"]}
        lane="agent"
        timeWindow="7d"
      />,
    );

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Coder");
      expect(container.textContent).toContain("Agent");
      expect(container.textContent).toContain("1 runs / last 7d");
    });

    root.unmount();
  });

  it("keeps task rows visible when the window has no runs or events", async () => {
    mockGet.mockResolvedValue(result({ actors: [], spans: [], events: [], edges: [] }));
    const { container, root } = render(
      <IssueExecutionTimeline
        companyId="company-1"
        issues={[issue]}
        issueIds={["issue-1"]}
        lane="task"
        timeWindow="24h"
      />,
    );

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Execution task");
      expect(container.textContent).toContain("0 runs / last 24h");
      expect(container.querySelector('[aria-label^="Task span"]')).not.toBeNull();
      expect(container.textContent).toContain("No delegation or assignment edges in this window.");
    });

    root.unmount();
  });
});
