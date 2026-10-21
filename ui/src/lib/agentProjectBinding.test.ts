import { describe, expect, it } from "vitest";
import type { Agent, Project } from "@paperclipai/shared";
import { resolveAgentBoundProject, resolveProjectTeamAgents } from "./agentProjectBinding";

const project = (overrides: Partial<Project>): Project => ({
  id: "project-1",
  companyId: "company-1",
  name: "vso-operations",
  status: "in_progress",
  leadAgentId: "pm-1",
  archivedAt: null,
  ...overrides,
} as Project);

const agent = (overrides: Partial<Agent>): Agent => ({
  id: "agent-1",
  reportsTo: null,
  ...overrides,
} as Agent);

describe("resolveAgentBoundProject", () => {
  it("binds a lead agent to the project it leads", () => {
    expect(resolveAgentBoundProject(agent({ id: "pm-1" }), [project({})])).toMatchObject({
      via: "lead",
      project: { id: "project-1" },
    });
  });

  it("binds a team member to the project led by its manager", () => {
    expect(resolveAgentBoundProject(agent({ reportsTo: "pm-1" }), [project({})])).toMatchObject({
      via: "team",
      project: { id: "project-1" },
    });
  });

  it("ignores archived projects and returns null when neither lead nor team applies", () => {
    expect(resolveAgentBoundProject(agent({ reportsTo: "pm-1" }), [
      project({ archivedAt: new Date() }),
    ])).toBeNull();
  });

  it("does not put a sub-project lead in the parent project team", () => {
    const ops = project({ id: "ops", name: "vso-operations", leadAgentId: "ops-pm" });
    const dfir = project({ id: "dfir", name: "vso-dfir", parentProjectId: "ops", leadAgentId: "dfir-pm" });
    const team = resolveProjectTeamAgents(
      ops,
      [
        agent({ id: "ops-pm" }),
        agent({ id: "dfir-pm", reportsTo: "ops-pm" }),
        agent({ id: "l1", reportsTo: "ops-pm" }),
      ],
      [ops, dfir],
    );
    expect(team.map((member) => member.id)).toEqual(["l1"]);
  });
});
