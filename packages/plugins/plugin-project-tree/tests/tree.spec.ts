import { describe, expect, it } from "vitest";
import {
  buildProjectTree,
  toProjectTreeData,
  type TreeAgentInput,
  type TreeProjectInput,
} from "../src/tree.js";

const agent = (
  id: string,
  name: string,
  reportsTo: string | null = null,
  title: string | null = null,
): TreeAgentInput => ({ id, name, title, reportsTo });

const project = (
  id: string,
  name: string,
  parentProjectId: string | null,
  leadAgentId: string | null,
  archivedAt: Date | null = null,
): TreeProjectInput => ({
  id,
  name,
  status: "active",
  parentProjectId,
  leadAgentId,
  archivedAt,
});

describe("buildProjectTree", () => {
  it("nests projects by parent and builds the 1:1 team", () => {
    const projects = [
      project("p0", "Robot System", null, "pm0"),
      project("p1", "Robot Brain", "p0", "pm1"),
      project("p2", "Robot Perception", "p1", "pm2"),
    ];
    const agents = [
      agent("pm0", "项目经理 · robot-product-pm"),
      agent("pm1", "项目经理 · robot-brain-pm", "pm0"),
      agent("re1", "需求分析师 · robot-brain-re", "pm1"),
      agent("de1", "开发工程师 · robot-brain-de", "pm1"),
      agent("pm2", "项目经理 · perception-pm", "pm1"),
    ];

    const tree = buildProjectTree(projects, agents);
    expect(tree).toHaveLength(1);
    const brain = tree[0]!.children[0]!;
    expect(tree[0]!.project.id).toBe("p0");
    expect(brain.project.id).toBe("p1");
    expect(brain.pm?.id).toBe("pm1");
    // pm2 leads its own project, so it is a sub-project lead, not a team member.
    expect(brain.team.map((member) => member.id)).toEqual(["re1", "de1"]);
    expect(brain.children[0]!.project.id).toBe("p2");
  });

  it("treats orphan projects as roots and ignores archived projects", () => {
    const projects = [
      project("p1", "Orphan", "missing", null),
      project("p2", "Archived", null, null, new Date()),
    ];
    const tree = buildProjectTree(projects, []);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.project.id).toBe("p1");
  });

  it("does not recurse forever on a cycle", () => {
    const projects = [project("a", "A", "b", null), project("b", "B", "a", null)];
    expect(buildProjectTree(projects, [])).toHaveLength(0);
  });

  it("keeps a project without a lead agent visible with an empty team", () => {
    const projects = [project("p1", "Unstaffed", null, null)];
    const agents = [agent("a1", "研发工程师", null)];
    const tree = buildProjectTree(projects, agents);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.pm).toBeNull();
    expect(tree[0]!.team).toEqual([]);
  });

  it("counts only active projects in stats and keeps agent totals", () => {
    const projects = [
      project("p1", "Live", null, "pm1"),
      project("p2", "Archived", null, null, new Date()),
    ];
    const agents = [agent("pm1", "项目经理"), agent("dev", "研发", "pm1")];
    const data = toProjectTreeData(projects, agents);
    expect(data.stats).toEqual({ projects: 1, agents: 2 });
    expect(data.roots).toHaveLength(1);
  });
});
