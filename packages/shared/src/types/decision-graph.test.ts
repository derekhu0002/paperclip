import { describe, expect, it } from "vitest";
import {
  GRAPH_CONTEXT_SCHEMA_VERSION,
  graphContextCompatibility,
  parseDecisionGraphContext,
} from "./decision-graph.js";

const preview = {
  nodes: [
    { id: "a", name: "A", type: "Application Component" },
    { id: "b", name: "B", type: "Application Component" },
  ],
  edges: [{ sourceId: "a", targetId: "b", type: "Serving" }],
};

describe("decision graph context", () => {
  it("keeps a versioned provider payload generic and unchanged in shape", () => {
    const parsed = parseDecisionGraphContext({
      schemaVersion: 1,
      provider: { name: "archgraph", version: null, fingerprint: "abc123", profileVersion: "1.0.0" },
      snapshotHash: "hash",
      focusElementIds: ["a"],
      preview,
      summary: "evidence",
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.schemaVersion).toBe(1);
    expect(parsed?.provider).toEqual({
      name: "archgraph",
      version: null,
      fingerprint: "abc123",
      profileVersion: "1.0.0",
    });
    expect(parsed?.preview?.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(graphContextCompatibility(parsed)).toBe("supported");
  });

  it("treats a payload without a schema version as legacy rather than failing", () => {
    const parsed = parseDecisionGraphContext({ focusElementIds: ["a"], preview });
    expect(parsed?.schemaVersion).toBeUndefined();
    expect(parsed?.provider).toBeUndefined();
    expect(graphContextCompatibility(parsed)).toBe("legacy");
  });

  it("reports an unknown future version instead of silently accepting it", () => {
    const parsed = parseDecisionGraphContext({
      schemaVersion: GRAPH_CONTEXT_SCHEMA_VERSION + 1,
      provider: { name: "future-graph" },
      focusElementIds: ["a"],
      preview,
    });
    expect(parsed?.schemaVersion).toBe(2);
    expect(parsed?.provider?.name).toBe("future-graph");
    expect(graphContextCompatibility(parsed)).toBe("unsupported");
  });

  it("still rejects payloads with no usable graph", () => {
    expect(parseDecisionGraphContext({ schemaVersion: 1, provider: { name: "x" } })).toBeNull();
    const empty = parseDecisionGraphContext({ focusElementIds: ["missing"], preview: { nodes: [], edges: [] } });
    expect(empty?.preview?.nodes).toEqual([]);
  });
});
