import type { Agent, Project } from "@paperclipai/shared";

export type AgentBoundProject = {
  project: Project;
  via: "lead" | "team";
};

export type AgentProjectRoles = {
  /** The project this agent leads, if any (at most one: leadAgentId is unique). */
  leadProject: Project | null;
  /** The project whose team this agent belongs to: its manager's project. */
  memberProject: Project | null;
};

/**
 * An agent reports to exactly one manager, so it belongs to at most one project
 * team. Leading a project is a separate role: an agent can lead a project and
 * still be a member of its manager's (parent) project team.
 */
export function resolveAgentProjectRoles(
  agent: Pick<Agent, "id" | "reportsTo">,
  projects: Project[],
): AgentProjectRoles {
  const activeProjects = projects.filter((project) => !project.archivedAt);
  const leadProject = activeProjects.find((project) => project.leadAgentId === agent.id) ?? null;
  const memberProject = agent.reportsTo
    ? activeProjects.find((project) => project.leadAgentId === agent.reportsTo) ?? null
    : null;
  return { leadProject, memberProject };
}

/** The single most specific project an agent is bound to (lead wins). */
export function resolveAgentBoundProject(
  agent: Pick<Agent, "id" | "reportsTo">,
  projects: Project[],
): AgentBoundProject | null {
  const { leadProject, memberProject } = resolveAgentProjectRoles(agent, projects);
  if (leadProject) return { project: leadProject, via: "lead" };
  if (memberProject) return { project: memberProject, via: "team" };
  return null;
}

/**
 * A project's team is the lead's direct reports. A report that also leads a
 * sub-project stays in this team: its single manager link is what makes the
 * membership, and its lead role is displayed separately.
 */
export function resolveProjectTeamAgents(
  project: Pick<Project, "leadAgentId">,
  agents: Agent[],
  _projects: Project[] = [],
): Agent[] {
  if (!project.leadAgentId) return [];
  return agents.filter(
    (agent) => agent.reportsTo === project.leadAgentId && agent.id !== project.leadAgentId,
  );
}
