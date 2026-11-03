import { describe, expect, it } from "vitest";
import manifest from "../src/manifest.js";

describe("done memory gate manifest", () => {
  it("declares the capabilities the end-of-conversation check uses", () => {
    for (const capability of [
      "events.subscribe",
      "issues.read",
      "agents.invoke",
      "issue.comments.read",
      "issue.documents.read",
      "plugin.state.read",
      "plugin.state.write",
    ]) {
      expect(manifest.capabilities).toContain(capability);
    }
    expect(manifest.capabilities).not.toContain("issues.update");
    expect(manifest.capabilities).not.toContain("issues.wakeup");
    expect(manifest.capabilities).not.toContain("issues.create");
  });

  it("ships a worker-only entrypoint", () => {
    expect(manifest.entrypoints.worker).toBe("./dist/worker.js");
    expect(manifest.entrypoints.ui).toBeUndefined();
    expect(manifest.ui).toBeUndefined();
    expect(manifest.skills).toBeUndefined();
  });

  it("defaults to strict graph mode with an opt-in document fallback", () => {
    expect(manifest.categories).toEqual(["automation"]);
    const properties = (manifest.instanceConfigSchema as {
      properties?: Record<string, { default?: unknown }>;
    } | undefined)?.properties;
    expect(properties?.allowIssueDocumentFallback?.default).toBe(false);
  });
});
