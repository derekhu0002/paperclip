import { and, eq } from "drizzle-orm";
import { projects, type agents, type Db } from "@paperclipai/db";
import { parseObject } from "../adapters/utils.js";
import { ConfigurationIncompleteFailure } from "../services/heartbeat/run-preparation.js";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Fork guard: a project's bound agent must execute on a remote environment in
 * the project's real checkout (direct remote workspace), never on the control
 * plane's local environment or a staged copy.
 *
 * Kept outside the upstream environment-selection module so upstream merges do
 * not conflict with this behavior.
 */
export async function assertProjectBoundAgentExecutionTarget(
  db: Db,
  agent: Pick<typeof agents.$inferSelect, "id" | "companyId" | "adapterType" | "adapterConfig"> & { name?: string | null },
  selectedEnvironmentForConfig: { driver: string; config: unknown } | null,
) {
  if (agent.adapterType !== "opencode_local") return;
  const agentName = agent.name ?? agent.id;
  const [bound] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.companyId, agent.companyId), eq(projects.leadAgentId, agent.id)))
    .limit(1);
  if (!bound) return;

  const config = parseObject(agent.adapterConfig);
  if (config.directRemoteWorkspace !== true) {
    throw new ConfigurationIncompleteFailure(
      `Project agent "${agentName}" must run with Direct remote workspace enabled so the project checkout is the real execution directory. Open Agent > Configuration and enable Direct remote workspace.`,
      {
        configurationIncomplete: {
          reason: "project_agent_direct_workspace_required",
          projectId: bound.id,
          agentId: agent.id,
        },
      },
    );
  }

  const driver = selectedEnvironmentForConfig?.driver ?? null;
  if (!driver || driver === "local") {
    throw new ConfigurationIncompleteFailure(
      `Project agent "${agentName}" is bound to project "${bound.name}" but resolves to the local environment. Set a remote execution environment on the agent so its task runs on the execution machine.`,
      {
        configurationIncomplete: {
          reason: "project_agent_remote_environment_required",
          projectId: bound.id,
          agentId: agent.id,
        },
      },
    );
  }

  if (driver === "ssh") {
    const environmentConfig = parseObject(selectedEnvironmentForConfig?.config);
    const remoteWorkspacePath = readNonEmptyString(environmentConfig.remoteWorkspacePath);
    if (!remoteWorkspacePath) {
      throw new ConfigurationIncompleteFailure(
        `Project agent "${agentName}" uses an SSH environment without a remote workspace path. Set the environment's remote workspace path to project "${bound.name}"'s real checkout.`,
        {
          configurationIncomplete: {
            reason: "project_agent_remote_workspace_path_required",
            projectId: bound.id,
            agentId: agent.id,
          },
        },
      );
    }
  }
}
