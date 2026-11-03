import { describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import {
  findMemoryCaptureMarker,
  findMemoryEvidence,
  hasSubstantiveMemoryDocument,
} from "../src/memory-evidence.js";
import { MEMORY_DOCUMENT_MIN_CHARS } from "../src/constants.js";
import { COMPANY_ID, doneEvent, makeIssue } from "./helpers.js";

const LONG_MEMORY = "Lessons and key decisions. ".repeat(12);

describe("memory evidence parsing", () => {
  it("extracts a machine-readable memory-capture marker", () => {
    expect(findMemoryCaptureMarker("done\nmemory-capture: argo:graph#element-1")).toBe(
      "argo:graph#element-1",
    );
    expect(findMemoryCaptureMarker("  MEMORY-CAPTURE :  doc:memory ")).toBe("doc:memory");
    expect(findMemoryCaptureMarker("no marker here")).toBeNull();
    expect(findMemoryCaptureMarker(null)).toBeNull();
  });

  it("accepts only a substantive memory document", () => {
    expect(hasSubstantiveMemoryDocument("short")).toBe(false);
    expect(hasSubstantiveMemoryDocument(" ".repeat(MEMORY_DOCUMENT_MIN_CHARS + 10))).toBe(false);
    expect(hasSubstantiveMemoryDocument(LONG_MEMORY)).toBe(true);
  });

  it("prefers a comment marker and falls back to the memory document", () => {
    expect(findMemoryEvidence({
      commentBodies: ["Finished.\nmemory-capture: argo:x#y"],
      memoryDocumentBody: LONG_MEMORY,
    })).toEqual({ kind: "comment-marker", detail: "argo:x#y" });
    expect(findMemoryEvidence({
      commentBodies: [],
      memoryDocumentBody: LONG_MEMORY,
    })).toEqual({ kind: "memory-document", detail: "memory document" });
    expect(findMemoryEvidence({ commentBodies: [], memoryDocumentBody: null })).toBeNull();
  });
});

describe("done memory gate evidence", () => {
  it("keeps done when a substantive memory document exists", async () => {
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);
    const issue = makeIssue({ id: "issue-doc" });
    harness.seed({ issues: [issue] });
    const wake = vi.spyOn(harness.ctx.issues, "requestWakeup");
    harness.ctx.issues.documents.get = async () => ({
      id: "doc-1",
      companyId: COMPANY_ID,
      issueId: issue.id,
      key: "memory",
      title: "Memory",
      format: "markdown",
      latestRevisionId: "rev-1",
      latestRevisionNumber: 1,
      createdByAgentId: null,
      createdByUserId: null,
      updatedByAgentId: null,
      updatedByUserId: null,
      lockedAt: null,
      lockedByAgentId: null,
      lockedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      body: LONG_MEMORY,
    }) as never;

    const event = doneEvent({ issue });
    await harness.emit("issue.updated", event.payload, event.base);

    const updated = await harness.ctx.issues.get(issue.id, COMPANY_ID);
    expect(updated?.status).toBe("done");
    expect(wake).not.toHaveBeenCalled();
  });
});
