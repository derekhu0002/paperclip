import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHarness, type TestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { MAX_GATE_ATTEMPTS, STATE_KEY_ATTEMPTS, STATE_NAMESPACE } from "../src/constants.js";
import { AGENT_ID, COMPANY_ID, doneEvent, makeIssue } from "./helpers.js";

async function setupHarness(): Promise<TestHarness> {
  const harness = createTestHarness({ manifest });
  await plugin.definition.setup(harness.ctx);
  return harness;
}

function attemptsKey(issueId: string) {
  return {
    scopeKind: "issue" as const,
    scopeId: issueId,
    namespace: STATE_NAMESPACE,
    stateKey: STATE_KEY_ATTEMPTS,
  };
}

describe("done memory gate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends an agent-closed done issue back to in_progress and wakes the assignee", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-1" });
    harness.seed({ issues: [issue] });
    const wake = vi.spyOn(harness.ctx.issues, "requestWakeup");

    await harness.emit("issue.updated", doneEvent({ issue }).payload, doneEvent({ issue }).base);

    const updated = await harness.ctx.issues.get(issue.id, COMPANY_ID);
    expect(updated?.status).toBe("in_progress");
    const comments = await harness.ctx.issues.listComments(issue.id, COMPANY_ID);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain("[done-memory-gate]");
    expect(comments[0].body).toContain("memory-capture:");
    expect(wake).toHaveBeenCalledWith(issue.id, COMPANY_ID);
  });

  it("keeps done when a memory-capture marker comment exists", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-2" });
    harness.seed({ issues: [issue] });
    await harness.ctx.issues.createComment(
      issue.id,
      "Finished.\nmemory-capture: argo:design/KG/SystemArchitecture.json#memory-123",
      COMPANY_ID,
    );
    const wake = vi.spyOn(harness.ctx.issues, "requestWakeup");

    await harness.emit("issue.updated", doneEvent({ issue }).payload, doneEvent({ issue }).base);

    const updated = await harness.ctx.issues.get(issue.id, COMPANY_ID);
    expect(updated?.status).toBe("done");
    expect(await harness.ctx.issues.listComments(issue.id, COMPANY_ID)).toHaveLength(1);
    expect(wake).not.toHaveBeenCalled();
  });

  it("does not gate a human close", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-3" });
    harness.seed({ issues: [issue] });

    const event = doneEvent({ issue, actorType: "user" });
    await harness.emit("issue.updated", event.payload, event.base);

    const updated = await harness.ctx.issues.get(issue.id, COMPANY_ID);
    expect(updated?.status).toBe("done");
    expect(await harness.ctx.issues.listComments(issue.id, COMPANY_ID)).toHaveLength(0);
  });

  it("does not gate an issue without an agent assignee", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-4", assigneeAgentId: null });
    harness.seed({ issues: [issue] });

    const event = doneEvent({ issue });
    await harness.emit("issue.updated", event.payload, event.base);

    const updated = await harness.ctx.issues.get(issue.id, COMPANY_ID);
    expect(updated?.status).toBe("done");
    expect(await harness.ctx.issues.listComments(issue.id, COMPANY_ID)).toHaveLength(0);
  });

  it("does not gate an update that is not a done transition", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-5", status: "in_progress" });
    harness.seed({ issues: [issue] });

    await harness.emit(
      "issue.updated",
      { changes: { priority: { from: "medium", to: "high" } }, _previous: { priority: "medium" } },
      { companyId: COMPANY_ID, entityId: issue.id, entityType: "issue", actorType: "agent" },
    );

    expect(await harness.ctx.issues.listComments(issue.id, COMPANY_ID)).toHaveLength(0);
  });

  it("stops reverting after the attempt cap and notifies once", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-6" });
    harness.seed({ issues: [issue] });
    await harness.ctx.state.set(attemptsKey(issue.id), MAX_GATE_ATTEMPTS);
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);
    await harness.emit("issue.updated", event.payload, event.base);

    const updated = await harness.ctx.issues.get(issue.id, COMPANY_ID);
    expect(updated?.status).toBe("done");
    const comments = await harness.ctx.issues.listComments(issue.id, COMPANY_ID);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain("attempt cap");
  });

  it("does not accept a marker that does not name a graph element", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-nongraph" });
    harness.seed({ issues: [issue] });
    await harness.ctx.issues.createComment(
      issue.id,
      "Finished.\nmemory-capture: doc:memory",
      COMPANY_ID,
    );

    const event = doneEvent({ issue });
    await harness.emit("issue.updated", event.payload, event.base);

    const updated = await harness.ctx.issues.get(issue.id, COMPANY_ID);
    expect(updated?.status).toBe("in_progress");
  });

  it("does not accept an issue document while strict graph mode is on", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-doc-strict" });
    harness.seed({ issues: [issue] });
    harness.ctx.issues.documents.get = async () => ({
      body: "Lessons and decisions. ".repeat(20),
    }) as never;

    const event = doneEvent({ issue });
    await harness.emit("issue.updated", event.payload, event.base);

    const updated = await harness.ctx.issues.get(issue.id, COMPANY_ID);
    expect(updated?.status).toBe("in_progress");
  });

  it("accepts an issue document only when the operator enables the fallback", async () => {
    const harness = await setupHarness();
    harness.setConfig({ allowIssueDocumentFallback: true });
    const issue = makeIssue({ id: "issue-doc-optin" });
    harness.seed({ issues: [issue] });
    harness.ctx.issues.documents.get = async () => ({
      body: "Lessons and decisions. ".repeat(20),
    }) as never;

    const event = doneEvent({ issue });
    await harness.emit("issue.updated", event.payload, event.base);

    const updated = await harness.ctx.issues.get(issue.id, COMPANY_ID);
    expect(updated?.status).toBe("done");
  });

  it("does not treat its own contract comment as memory evidence", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-self" });
    harness.seed({ issues: [issue] });
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);
    const second = await harness.ctx.issues.get(issue.id, COMPANY_ID);
    expect(second?.status).toBe("in_progress");
    await harness.ctx.issues.update(issue.id, { status: "done" }, COMPANY_ID);
    await harness.emit("issue.updated", event.payload, event.base);

    const updated = await harness.ctx.issues.get(issue.id, COMPANY_ID);
    expect(updated?.status).toBe("in_progress");
    expect(await harness.ctx.issues.listComments(issue.id, COMPANY_ID)).toHaveLength(2);
  });

  it("ignores plugin operation issues", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({
      id: "issue-7",
      originKind: `plugin:${manifest.id}`,
      assigneeAgentId: AGENT_ID,
    });
    harness.seed({ issues: [issue] });
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);

    const updated = await harness.ctx.issues.get(issue.id, COMPANY_ID);
    expect(updated?.status).toBe("done");
    expect(await harness.ctx.issues.listComments(issue.id, COMPANY_ID)).toHaveLength(0);
  });
});
