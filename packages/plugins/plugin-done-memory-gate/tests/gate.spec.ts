import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHarness, type TestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { AGENT_ID, COMPANY_ID, doneEvent, makeAgent, makeComment, makeIssue } from "./helpers.js";

async function setupHarness(): Promise<{
  harness: TestHarness;
  invoke: ReturnType<typeof vi.spyOn>;
}> {
  const harness = createTestHarness({ manifest });
  await plugin.definition.setup(harness.ctx);
  harness.seed({ agents: [makeAgent()] });
  const invoke = vi
    .spyOn(harness.ctx.agents, "invoke")
    .mockResolvedValue({ runId: "run-1" });
  return { harness, invoke };
}

async function issueCount(harness: TestHarness): Promise<number> {
  return (await harness.ctx.issues.list({ companyId: COMPANY_ID })).length;
}

describe("done memory gate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("wakes the same agent for memory capture without creating a task", async () => {
    const { harness, invoke } = await setupHarness();
    const issue = makeIssue({ id: "issue-1" });
    harness.seed({ issues: [issue] });
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);

    const updated = await harness.ctx.issues.get(issue.id, COMPANY_ID);
    expect(updated?.status).toBe("done");
    expect(await issueCount(harness)).toBe(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    const [agentId, companyId, opts] = invoke.mock.calls[0];
    expect(agentId).toBe(AGENT_ID);
    expect(companyId).toBe(COMPANY_ID);
    expect(opts).toMatchObject({ reason: "done_memory_capture" });
    expect(opts.prompt).toContain("memory-capture: argo:");
    expect(opts.prompt).toContain(issue.identifier ?? issue.id);
    expect(await harness.ctx.issues.listComments(issue.id, COMPANY_ID)).toHaveLength(0);
  });

  it("does not wake the agent twice for the same ended conversation", async () => {
    const { harness, invoke } = await setupHarness();
    const issue = makeIssue({ id: "issue-2" });
    harness.seed({ issues: [issue] });
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);
    await harness.emit("issue.updated", event.payload, event.base);

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("stays silent when a graph element reference exists", async () => {
    const { harness, invoke } = await setupHarness();
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

    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not accept a marker that does not name a graph element", async () => {
    const { harness, invoke } = await setupHarness();
    const issue = makeIssue({ id: "issue-4" });
    harness.seed({ issues: [issue] });
    harness.seed({
      issueComments: [makeComment(issue, "Finished.\nmemory-capture: doc:memory")],
    });
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not accept an issue document in strict mode", async () => {
    const { harness, invoke } = await setupHarness();
    const issue = makeIssue({ id: "issue-5" });
    harness.seed({ issues: [issue] });
    harness.ctx.issues.documents.get = async () => ({
      body: "Lessons and decisions. ".repeat(20),
    }) as never;
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("accepts an issue document only when the operator enables the fallback", async () => {
    const { harness, invoke } = await setupHarness();
    harness.setConfig({ allowIssueDocumentFallback: true });
    const issue = makeIssue({ id: "issue-6" });
    harness.seed({ issues: [issue] });
    harness.ctx.issues.documents.get = async () => ({
      body: "Lessons and decisions. ".repeat(20),
    }) as never;
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);

    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not check a human close", async () => {
    const { harness, invoke } = await setupHarness();
    const issue = makeIssue({ id: "issue-7" });
    harness.seed({ issues: [issue] });
    const event = doneEvent({ issue, actorType: "user" });

    await harness.emit("issue.updated", event.payload, event.base);

    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not check an issue without an agent assignee", async () => {
    const { harness, invoke } = await setupHarness();
    const issue = makeIssue({ id: "issue-8", assigneeAgentId: null });
    harness.seed({ issues: [issue] });
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);

    expect(invoke).not.toHaveBeenCalled();
  });

  it("ignores updates that are not a done transition", async () => {
    const { harness, invoke } = await setupHarness();
    const issue = makeIssue({ id: "issue-9", status: "in_progress" });
    harness.seed({ issues: [issue] });

    await harness.emit(
      "issue.updated",
      { changes: { priority: { from: "medium", to: "high" } }, _previous: { priority: "medium" } },
      { companyId: COMPANY_ID, entityId: issue.id, entityType: "issue", actorType: "agent" },
    );

    expect(invoke).not.toHaveBeenCalled();
  });

  it("skips plugin operation issues", async () => {
    const { harness, invoke } = await setupHarness();
    const issue = makeIssue({
      id: "issue-10",
      originKind: `plugin:${manifest.id}`,
    });
    harness.seed({ issues: [issue] });
    const event = doneEvent({ issue });

    await harness.emit("issue.updated", event.payload, event.base);

    expect(invoke).not.toHaveBeenCalled();
  });
});
