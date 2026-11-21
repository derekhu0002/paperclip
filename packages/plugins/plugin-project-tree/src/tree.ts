/**
 * Project tree builder.
 *
 * A project maps 1:1 to its team: the PM is the lead agent, and the team is
 * the PM's direct reports. An agent reports to exactly one manager, so it is
 * a member of exactly one project team; it may additionally lead one project
 * (and then appears both as that project's PM and as a member of its
 * manager's project).
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
  /** The project this agent leads, when it is also a member of another team. */
  leadsProject?: { id: string; name: string } | null;
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
  /** Active projects, for the tree editor (parent picker, optimistic reparent). */
  projects: TreeProjectInput[];
  /** Agents, for team rendering and dual-role badges. */
  agents: TreeAgentInput[];
}

function toAgent(agent: TreeAgentInput, leadsProject: { id: string; name: string } | null = null): TreeAgent {
  return {
    id: agent.id,
    name: agent.name,
    title: agent.title ?? null,
    ...(leadsProject ? { leadsProject } : {}),
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
  const projectByLeadAgent = new Map<string, { id: string; name: string }>();
  for (const project of active) {
    if (project.leadAgentId) projectByLeadAgent.set(project.leadAgentId, { id: project.id, name: project.name });
  }

  const build = (project: TreeProjectInput, ancestors: Set<string>): ProjectTreeNode | null => {
    if (ancestors.has(project.id)) return null;
    const nextAncestors = new Set(ancestors).add(project.id);
    const pm = project.leadAgentId ? agentById.get(project.leadAgentId) ?? null : null;
    // Membership follows the single manager link: every direct report belongs
    // to this team, including a report that leads a sub-project. Excluding
    // sub-project leads here would hide a real (and intended) dual role.
    const team = pm
      ? agents
        .filter((agent) => agent.reportsTo === pm.id && agent.id !== pm.id)
        .map((agent) => toAgent(agent, projectByLeadAgent.get(agent.id) ?? null))
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
  const activeProjects = projects.filter((project) => !project.archivedAt);
  return {
    stats: {
      projects: activeProjects.length,
      agents: agents.length,
    },
    roots,
    projects: activeProjects,
    agents,
  };
}

export interface ReparentCheck {
  ok: boolean;
  reason?:
    | "self"
    | "missing-project"
    | "missing-parent"
    | "archived-parent"
    | "cycle";
}

/**
 * Whether `projectId` may be moved under `parentProjectId` (null = root).
 * A project has at most one parent, so this only checks the single-parent tree
 * invariants: never self, never an unknown/archived parent, never a descendant.
 */
export function checkProjectReparent(
  projects: TreeProjectInput[],
  projectId: string,
  parentProjectId: string | null,
): ReparentCheck {
  const active = projects.filter((project) => !project.archivedAt);
  const byId = new Map(active.map((project) => [project.id, project]));
  if (!byId.has(projectId)) return { ok: false, reason: "missing-project" };
  if (parentProjectId === null) return { ok: true };
  if (parentProjectId === projectId) return { ok: false, reason: "self" };
  const parent = byId.get(parentProjectId);
  if (!parent) {
    const archived = projects.some((project) => project.id === parentProjectId && project.archivedAt);
    return { ok: false, reason: archived ? "archived-parent" : "missing-parent" };
  }
  // Walk up from the candidate parent: reaching the project means the parent
  // is one of its own descendants.
  const seen = new Set<string>();
  let current: string | null = parent.parentProjectId ?? null;
  while (current) {
    if (current === projectId) return { ok: false, reason: "cycle" };
    if (seen.has(current)) return { ok: false, reason: "cycle" };
    seen.add(current);
    current = byId.get(current)?.parentProjectId ?? null;
  }
  return { ok: true };
}

/** Descendant project ids (excluding the project itself), for UI hints. */
export function projectDescendantIds(projects: TreeProjectInput[], projectId: string): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const project of projects) {
    if (!project.parentProjectId) continue;
    const list = byParent.get(project.parentProjectId) ?? [];
    list.push(project.id);
    byParent.set(project.parentProjectId, list);
  }
  const result = new Set<string>();
  const stack = [...(byParent.get(projectId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    stack.push(...(byParent.get(id) ?? []));
  }
  return result;
}
