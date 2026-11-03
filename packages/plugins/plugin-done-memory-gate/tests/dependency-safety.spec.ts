import { describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { AGENT_ID, COMPANY_ID, doneEvent, makeIssue } from "./helpers.js";

describe("done memory gate dependency safety", () => {
  it("keeps done and only reminds when the issue blocks a dependent", async () => {
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);

    const issue = makeIssue({ id: "issue-parent" });
    const dependent = makeIssue({
      id: "issue-dependent",
      identifier: "PAP-2",
      status: "blocked",
      blockedBy: [{
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        status: "done",
        priority: "medium",
        assigneeAgentId: AGENT_ID,
        assigneeUserId: null,
      }],
    });
    harness.seed({ issues: [issue, dependent] });
    const wake = vi.spyOn(harness.ctx.issues, "requestWakeup");

    const event = doneEvent({ issue });
    await harness.emit("issue.updated", event.payload, event.base);

    const updated = await harness.ctx.issues.get(issue.id, COMPANY_ID);
    expect(updated?.status).toBe("done");
    expect(wake).not.toHaveBeenCalled();
    const comments = await harness.ctx.issues.listComments(issue.id, COMPANY_ID);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain("staying");
    expect(comments[0].body).toContain("dependent task");
  });
});
