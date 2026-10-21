import type { Agent, Project } from "@paperclipai/shared";

export interface ProjectTreeNode {
  project: Project;
  pm: Agent | null;
  team: Agent[];
  children: ProjectTreeNode[];
}

/**
 * Build the organization tree from project parent links. A project maps 1:1 to
 * its team: the PM is the lead agent, and the team is the PM's direct reports
 * that do not themselves lead another project.
 */
export function buildProjectTree(projects: Project[], agents: Agent[]): ProjectTreeNode[] {
  const active = projects.filter((project) => !project.archivedAt);
  const projectIds = new Set(active.map((project) => project.id));
  const childrenByParent = new Map<string, Project[]>();
  for (const project of active) {
    if (!project.parentProjectId || !projectIds.has(project.parentProjectId)) continue;
    const siblings = childrenByParent.get(project.parentProjectId) ?? [];
    siblings.push(project);
    childrenByParent.set(project.parentProjectId, siblings);
  }

  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const leadAgentIds = new Set(
    active.map((project) => project.leadAgentId).filter((id): id is string => Boolean(id)),
  );

  const build = (project: Project, ancestors: Set<string>): ProjectTreeNode | null => {
    if (ancestors.has(project.id)) return null;
    const nextAncestors = new Set(ancestors).add(project.id);
    const pm = project.leadAgentId ? agentById.get(project.leadAgentId) ?? null : null;
    const team = pm
      ? agents.filter((agent) => agent.reportsTo === pm.id && !leadAgentIds.has(agent.id))
      : [];
    return {
      project,
      pm,
      team,
      children: (childrenByParent.get(project.id) ?? [])
        .map((child) => build(child, nextAncestors))
        .filter((node): node is ProjectTreeNode => node !== null),
    };
  };

  return active
    .filter((project) => !project.parentProjectId || !projectIds.has(project.parentProjectId))
    .map((project) => build(project, new Set()))
    .filter((node): node is ProjectTreeNode => node !== null);
}
