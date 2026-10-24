/**
 * Project tree builder.
 *
 * A project maps 1:1 to its team: the PM is the lead agent, and the team is
 * the PM's direct reports that do not themselves lead another project.
 *
 * Ported from the fork's previous host page so the same semantics keep their
 * regression coverage after the page moved into a plugin.
 */
export interface TreeProjectInput {
  id: string;
  name: string;
  status: string;
  parentProjectId?: string | null;
  leadAgentId: string | null;
  archivedAt?: string | Date | null;
}

export interface TreeAgentInput {
  id: string;
  name: string;
  title?: string | null;
  reportsTo?: string | null;
}

export interface TreeAgent {
  id: string;
  name: string;
  title: string | null;
}

export interface TreeProject {
  id: string;
  name: string;
  status: string;
}

export interface ProjectTreeNode {
  project: TreeProject;
  pm: TreeAgent | null;
  team: TreeAgent[];
  children: ProjectTreeNode[];
}

export interface ProjectTreeData {
  stats: {
    projects: number;
    agents: number;
  };
  roots: ProjectTreeNode[];
}

function toAgent(agent: TreeAgentInput): TreeAgent {
  return {
    id: agent.id,
    name: agent.name,
    title: agent.title ?? null,
  };
}

/**
 * Build the project forest from `parentProjectId` links.
 *
 * Archived projects are excluded. Orphan projects (missing parent, or a parent
 * that is archived/absent) stay visible as roots. Cycles cannot recurse forever:
 * a node already on the current path is dropped.
 */
export function buildProjectTree(
  projects: TreeProjectInput[],
  agents: TreeAgentInput[],
): ProjectTreeNode[] {
  const active = projects.filter((project) => !project.archivedAt);
  const projectIds = new Set(active.map((project) => project.id));

  const childrenByParent = new Map<string, TreeProjectInput[]>();
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

  const build = (project: TreeProjectInput, ancestors: Set<string>): ProjectTreeNode | null => {
    if (ancestors.has(project.id)) return null;
    const nextAncestors = new Set(ancestors).add(project.id);
    const pm = project.leadAgentId ? agentById.get(project.leadAgentId) ?? null : null;
    const team = pm
      ? agents.filter((agent) => agent.reportsTo === pm.id && !leadAgentIds.has(agent.id)).map(toAgent)
      : [];
    return {
      project: { id: project.id, name: project.name, status: project.status },
      pm: pm ? toAgent(pm) : null,
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

export function toProjectTreeData(
  projects: TreeProjectInput[],
  agents: TreeAgentInput[],
): ProjectTreeData {
  const roots = buildProjectTree(projects, agents);
  return {
    stats: {
      projects: projects.filter((project) => !project.archivedAt).length,
      agents: agents.length,
    },
    roots,
  };
}
