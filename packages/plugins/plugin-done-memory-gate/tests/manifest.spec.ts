import { describe, expect, it } from "vitest";
import manifest from "../src/manifest.js";
import { MEMORY_CAPTURE_SKILL_KEY } from "../src/constants.js";

describe("done memory gate manifest", () => {
  it("declares the runtime capabilities the gate uses", () => {
    for (const capability of [
      "events.subscribe",
      "issues.read",
      "issues.update",
      "issues.wakeup",
      "issue.comments.read",
      "issue.comments.create",
      "issue.documents.read",
      "issue.relations.read",
      "skills.managed",
      "plugin.state.read",
      "plugin.state.write",
    ]) {
      expect(manifest.capabilities).toContain(capability);
    }
  });

  it("ships a worker entrypoint and the memory capture skill", () => {
    expect(manifest.entrypoints.worker).toBe("./dist/worker.js");
    expect(manifest.entrypoints.ui).toBeUndefined();
    expect(manifest.skills).toContainEqual(expect.objectContaining({
      skillKey: MEMORY_CAPTURE_SKILL_KEY,
      slug: "task-memory-capture",
    }));
    expect(manifest.skills?.[0]?.markdown).toContain("memory-capture:");
  });

  it("is an automation plugin and not a UI plugin", () => {
    expect(manifest.categories).toEqual(["automation"]);
    expect(manifest.ui).toBeUndefined();
  });

  it("defaults to strict graph mode with an opt-in document fallback", () => {
    const properties = (manifest.instanceConfigSchema as {
      properties?: Record<string, { default?: unknown }>;
    } | undefined)?.properties;
    expect(properties?.allowIssueDocumentFallback?.default).toBe(false);
  });
});
