import { describe, expect, it } from "vitest";
import { COLUMN_GAP, NODE_HEIGHT, NODE_WIDTH, layoutProjectTree } from "../src/layout.js";
import { buildProjectTree, type TreeAgentInput, type TreeProjectInput } from "../src/tree.js";

const project = (
  id: string,
  name: string,
  parentProjectId: string | null = null,
  leadAgentId: string | null = null,
): TreeProjectInput => ({ id, name, status: "active", parentProjectId, leadAgentId, archivedAt: null });

const tree = () => buildProjectTree([
  project("root", "Root", null, "pm-root"),
  project("a", "A", "root", "pm-a"),
  project("b", "B", "root", "pm-b"),
  project("a1", "A1", "a", "pm-a1"),
], [] as TreeAgentInput[]);

describe("layoutProjectTree", () => {
  it("places depth on the x axis and siblings down the y axis", () => {
    const layout = layoutProjectTree(tree(), new Set());
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    expect(byId.get("root")!.x).toBe(0);
    expect(byId.get("a")!.x).toBe(NODE_WIDTH + COLUMN_GAP);
    expect(byId.get("a1")!.x).toBe(2 * (NODE_WIDTH + COLUMN_GAP));
    expect(byId.get("a")!.y).toBeLessThan(byId.get("b")!.y);
    // The root centers between its two visible children.
    const rootCenter = byId.get("root")!.y + NODE_HEIGHT / 2;
    const aCenter = byId.get("a")!.y + NODE_HEIGHT / 2;
    const bCenter = byId.get("b")!.y + NODE_HEIGHT / 2;
    expect(rootCenter).toBeCloseTo((aCenter + bCenter) / 2, 5);
  });

  it("draws one edge per visible parent/child link", () => {
    const layout = layoutProjectTree(tree(), new Set());
    expect(layout.edges.map((edge) => `${edge.from}->${edge.to}`).sort()).toEqual(
      ["a->a1", "root->a", "root->b"],
    );
  });

  it("hides a collapsed node's descendants and their edges", () => {
    const layout = layoutProjectTree(tree(), new Set(["a"]));
    expect(layout.nodes.map((node) => node.id).sort()).toEqual(["a", "b", "root"]);
    expect(layout.edges.map((edge) => `${edge.from}->${edge.to}`).sort()).toEqual(["root->a", "root->b"]);
    expect(layout.nodes.find((node) => node.id === "a")!.collapsed).toBe(true);
  });
});
