// @vitest-environment jsdom

import { act as reactAct, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Approval } from "@paperclipai/shared";
import { ApprovalCard } from "./ApprovalCard";
import { ThemeProvider } from "../context/ThemeContext";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  if (typeof reactAct === "function") {
    await reactAct(callback);
    return;
  }
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

vi.mock("@/lib/router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
}));

function render(approval: Approval) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<ThemeProvider><ApprovalCard approval={approval} requesterAgent={null} /></ThemeProvider>);
  });
  return container!;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("ApprovalCard graph evidence", () => {
  it("renders a bounded graph region and no graph navigation", async () => {
    const el = render({
      id: "approval-1",
      companyId: "company-1",
      type: "request_board_approval",
      requestedByAgentId: null,
      requestedByUserId: null,
      status: "pending",
      payload: {
        title: "Approve the identity-control change",
        summary: "Review the affected OAuth and telemetry nodes.",
        recommendedAction: "Approve after reviewing the evidence.",
        graphContext: {
          focusElementIds: ["oauth"],
          preview: {
            nodes: [
              { id: "oauth", name: "OAuth consent", type: "Requirement" },
              { id: "telemetry", name: "Telemetry access", type: "Application Component" },
            ],
            edges: [{ sourceId: "oauth", targetId: "telemetry", type: "Serving" }],
          },
          summary: "Graph evidence from SystemArchitecture.json",
        },
      },
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(el.textContent).toContain("Graph evidence");
    expect(el.textContent).toContain("OAuth consent");
    expect(el.querySelector("svg")).toBeTruthy();
    expect(el.textContent).not.toContain("Open graph");
  });
});
