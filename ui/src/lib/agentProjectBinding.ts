import type { Agent, Project } from "@paperclipai/shared";

export type AgentBoundProject = {
  project: Project;
  via: "lead" | "team";
};

export function resolveAgentBoundProject(
  agent: Pick<Agent, "id" | "reportsTo">,
  projects: Project[],
): AgentBoundProject | null {
  const activeProjects = projects.filter((project) => !project.archivedAt);
  const led = activeProjects.find((project) => project.leadAgentId === agent.id);
  if (led) return { project: led, via: "lead" };
  if (!agent.reportsTo) return null;
  const team = activeProjects.find((project) => project.leadAgentId === agent.reportsTo);
  return team ? { project: team, via: "team" } : null;
}

export function resolveProjectTeamAgents(
  project: Pick<Project, "leadAgentId">,
  agents: Agent[],
  projects: Project[],
): Agent[] {
  if (!project.leadAgentId) return [];
  const leadIds = new Set(
    projects
      .filter((candidate) => !candidate.archivedAt && candidate.leadAgentId)
      .map((candidate) => candidate.leadAgentId),
  );
  return agents.filter(
    (agent) =>
      agent.reportsTo === project.leadAgentId &&
      agent.id !== project.leadAgentId &&
      !leadIds.has(agent.id),
  );
}
