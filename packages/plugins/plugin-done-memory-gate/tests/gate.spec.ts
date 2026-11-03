import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHarness, type TestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { AGENT_ID, COMPANY_ID, doneEvent, makeComment, makeIssue } from "./helpers.js";

async function setupHarness(): Promise<TestHarness> {
  const harness = createTestHarness({ manifest });
  await plugin.definition.setup(harness.ctx);
  return harness;
}

async function listFollowUps(harness: TestHarness, parentId: string) {
  const issues = await harness.ctx.issues.list({ companyId: COMPANY_ID });
  return issues.filter((issue) => issue.parentId === parentId);
}

describe("done memory gate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps done but creates a follow-up memory task when graph memory is missing", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-1" });
    harness.seed({ issues: [issue] });
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);

    const updated = await harness.ctx.issues.get(issue.id, COMPANY_ID);
    expect(updated?.status).toBe("done");

    const followUps = await listFollowUps(harness, issue.id);
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toMatchObject({
      status: "todo",
      assigneeAgentId: AGENT_ID,
      originKind: `plugin:${manifest.id}`,
      originId: issue.id,
    });
    expect(followUps[0].title).toContain("记录任务记忆");
    expect(followUps[0].description).toContain("memory-capture: argo:");

    expect(await harness.ctx.issues.listComments(issue.id, COMPANY_ID)).toHaveLength(0);
  });

  it("does not create a second follow-up for the same ended conversation", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-2" });
    harness.seed({ issues: [issue] });
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);
    await harness.emit("issue.updated", event.payload, event.base);

    expect(await listFollowUps(harness, issue.id)).toHaveLength(1);
  });

  it("stays silent when a graph element reference exists", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-3" });
    harness.seed({ issues: [issue] });
    harness.seed({
      issueComments: [makeComment(
        issue,
        "Finished.\nmemory-capture: argo:design/KG/SystemArchitecture.json#memory-123",
      )],
    });
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);

    expect(await listFollowUps(harness, issue.id)).toHaveLength(0);
    expect(await harness.ctx.issues.listComments(issue.id, COMPANY_ID)).toHaveLength(1);
  });

  it("does not accept a marker that does not name a graph element", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-4" });
    harness.seed({ issues: [issue] });
    harness.seed({
      issueComments: [makeComment(issue, "Finished.\nmemory-capture: doc:memory")],
    });
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);

    expect(await listFollowUps(harness, issue.id)).toHaveLength(1);
  });

  it("does not accept an issue document in strict mode", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-5" });
    harness.seed({ issues: [issue] });
    harness.ctx.issues.documents.get = async () => ({
      body: "Lessons and decisions. ".repeat(20),
    }) as never;
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);

    expect(await listFollowUps(harness, issue.id)).toHaveLength(1);
  });

  it("accepts an issue document only when the operator enables the fallback", async () => {
    const harness = await setupHarness();
    harness.setConfig({ allowIssueDocumentFallback: true });
    const issue = makeIssue({ id: "issue-6" });
    harness.seed({ issues: [issue] });
    harness.ctx.issues.documents.get = async () => ({
      body: "Lessons and decisions. ".repeat(20),
    }) as never;
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);

    expect(await listFollowUps(harness, issue.id)).toHaveLength(0);
  });

  it("does not check a human close", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-7" });
    harness.seed({ issues: [issue] });
    const event = doneEvent({ issue, actorType: "user" });

    await harness.emit("issue.updated", event.payload, event.base);

    expect(await listFollowUps(harness, issue.id)).toHaveLength(0);
    expect(await harness.ctx.issues.listComments(issue.id, COMPANY_ID)).toHaveLength(0);
  });

  it("does not check an issue without an agent assignee", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-8", assigneeAgentId: null });
    harness.seed({ issues: [issue] });
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);

    expect(await listFollowUps(harness, issue.id)).toHaveLength(0);
  });

  it("ignores updates that are not a done transition", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({ id: "issue-9", status: "in_progress" });
    harness.seed({ issues: [issue] });

    await harness.emit(
      "issue.updated",
      { changes: { priority: { from: "medium", to: "high" } }, _previous: { priority: "medium" } },
      { companyId: COMPANY_ID, entityId: issue.id, entityType: "issue", actorType: "agent" },
    );

    expect(await listFollowUps(harness, issue.id)).toHaveLength(0);
  });

  it("skips plugin operation issues", async () => {
    const harness = await setupHarness();
    const issue = makeIssue({
      id: "issue-10",
      originKind: `plugin:${manifest.id}`,
    });
    harness.seed({ issues: [issue] });
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);

    expect(await listFollowUps(harness, issue.id)).toHaveLength(0);
  });
});
