import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import { DATA_KEYS, PLUGIN_ID } from "./constants.js";
import {
  toProjectTreeData,
  type ProjectTreeData,
  type TreeAgentInput,
  type TreeProjectInput,
} from "./tree.js";

const PAGE_SIZE = 200;
const MAX_PAGES = 10;

async function listAllProjects(ctx: PluginContext, companyId: string) {
  const rows: Awaited<ReturnType<PluginContext["projects"]["list"]>> = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await ctx.projects.list({
      companyId,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

async function listAllAgents(ctx: PluginContext, companyId: string) {
  const rows: Awaited<ReturnType<PluginContext["agents"]["list"]>> = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await ctx.agents.list({
      companyId,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

function toTreeProject(project: Awaited<ReturnType<PluginContext["projects"]["list"]>>[number]): TreeProjectInput {
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    parentProjectId: project.parentProjectId ?? null,
    leadAgentId: project.leadAgentId ?? null,
    archivedAt: project.archivedAt ?? null,
  };
}

function toTreeAgent(agent: Awaited<ReturnType<PluginContext["agents"]["list"]>>[number]): TreeAgentInput {
  return {
    id: agent.id,
    name: agent.name,
    title: agent.title ?? null,
    reportsTo: agent.reportsTo ?? null,
  };
}

export const EMPTY_TREE: ProjectTreeData = {
  stats: { projects: 0, agents: 0 },
  roots: [],
};

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info(`[${PLUGIN_ID}] setting up project tree plugin`);

    ctx.data.register(DATA_KEYS.tree, async (params): Promise<ProjectTreeData> => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      if (!companyId) return EMPTY_TREE;
      const [projects, agents] = await Promise.all([
        listAllProjects(ctx, companyId),
        listAllAgents(ctx, companyId),
      ]);
      return toProjectTreeData(projects.map(toTreeProject), agents.map(toTreeAgent));
    });
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
