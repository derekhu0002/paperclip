import {
  definePlugin,
  runWorker,
  type PluginApiRequestInput,
  type PluginContext,
} from "@paperclipai/plugin-sdk";
import {
  METRICS_KEY,
  METRICS_NAMESPACE,
  PLUGIN_ID,
  PROFILE_KEY,
  PROFILE_NAMESPACE,
  type BusinessProfile,
  type CockpitPayload,
  type Snapshot,
  type SnapshotValue,
} from "./shared.js";
import {
  buildCockpitPayload,
  computePaperclipMetrics,
  parseGovernanceConfig,
  parseSnapshotValues,
  writerDecision,
  type IngestValue,
  type GovernanceValidation,
} from "./logic.js";
import { metricSourcesForProfile, snapshotIdsForProfile, validateProfile } from "./profile.js";

const SNAPSHOT_SCOPE = {
  scopeKind: "company" as const,
  namespace: METRICS_NAMESPACE,
  stateKey: METRICS_KEY,
};
const PROFILE_SCOPE = {
  scopeKind: "company" as const,
  namespace: PROFILE_NAMESPACE,
  stateKey: PROFILE_KEY,
};

let pluginContext: PluginContext | null = null;

function requireContext(): PluginContext {
  if (!pluginContext) throw new Error("business-status plugin context is not ready");
  return pluginContext;
}

function snapshotScope(companyId: string) {
  return { ...SNAPSHOT_SCOPE, scopeId: companyId };
}

function profileScope(companyId: string) {
  return { ...PROFILE_SCOPE, scopeId: companyId };
}

async function readProfile(ctx: PluginContext, companyId: string): Promise<BusinessProfile | null> {
  try {
    const raw = await ctx.state.get(profileScope(companyId));
    if (!raw || typeof raw !== "object") return null;
    const validation = validateProfile(raw);
    return validation.ok ? validation.profile : null;
  } catch (error) {
    ctx.logger.warn("failed to read business cockpit profile", { companyId, error: String(error) });
    return null;
  }
}

async function writeProfile(ctx: PluginContext, companyId: string, profile: BusinessProfile): Promise<void> {
  await ctx.state.set(profileScope(companyId), profile);
}

async function readSnapshot(ctx: PluginContext, companyId: string): Promise<Snapshot | null> {
  try {
    const raw = await ctx.state.get(snapshotScope(companyId));
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as Partial<Snapshot>;
    const values = candidate.values as Record<string, unknown> | undefined;
    if (!values || typeof values !== "object") return null;
    const normalized: Record<string, SnapshotValue> = {};
    for (const [id, entry] of Object.entries(values)) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const value = typeof record.value === "number" && Number.isFinite(record.value) ? record.value : null;
      if (value == null) continue;
      normalized[id] = {
        value,
        asOf: typeof record.asOf === "string" ? record.asOf : new Date(0).toISOString(),
        source: typeof record.source === "string" ? record.source : "snapshot",
        commit: typeof record.commit === "string" ? record.commit : null,
        digest: typeof record.digest === "string" ? record.digest : null,
        note: typeof record.note === "string" ? record.note : null,
        reportedBy: typeof record.reportedBy === "string" ? record.reportedBy : null,
        reportedAt: typeof record.reportedAt === "string" ? record.reportedAt : null,
      };
    }
    return {
      schema: "paperclip.business-status.snapshot/v1",
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date(0).toISOString(),
      values: normalized,
    };
  } catch (error) {
    ctx.logger.warn("failed to read business snapshot", { companyId, error: String(error) });
    return null;
  }
}

async function writeSnapshot(ctx: PluginContext, companyId: string, snapshot: Snapshot): Promise<void> {
  await ctx.state.set(snapshotScope(companyId), snapshot);
}

async function listAll<T>(
  fetch: (input: { companyId: string; limit: number; offset: number }) => Promise<T[]>,
  companyId: string,
  pageSize = 500,
  max = 5000,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (offset < max) {
    const rows = await fetch({ companyId, limit: pageSize, offset });
    all.push(...rows);
    if (rows.length < pageSize) break;
    offset += rows.length;
  }
  return all;
}

async function buildForCompany(ctx: PluginContext, companyId: string): Promise<CockpitPayload> {
  const now = Date.now();
  const profile = await readProfile(ctx, companyId);
  const snapshot = await readSnapshot(ctx, companyId);
  if (!profile) return buildCockpitPayload(null, {}, snapshot, now, companyId);
  const [issues, goals, agents] = await Promise.all([
    listAll((input) => ctx.issues.list(input), companyId),
    listAll((input) => ctx.goals.list(input), companyId, 200, 2000),
    listAll((input) => ctx.agents.list(input), companyId, 200, 2000),
  ]);
  const computed = computePaperclipMetrics({ issues, goals, agents, now });
  return buildCockpitPayload(profile, computed, snapshot, now, companyId);
}

async function logActivity(
  ctx: PluginContext,
  companyId: string,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await ctx.activity.log({ companyId, message, entityType: "plugin", entityId: PLUGIN_ID, metadata });
  } catch (error) {
    ctx.logger.warn("activity log write failed", { error: String(error) });
  }
}

function actorLabel(input: PluginApiRequestInput): string {
  if (input.actor.actorType === "agent") return `agent:${input.actor.agentId ?? input.actor.actorId}`;
  return `user:${input.actor.userId ?? input.actor.actorId}`;
}

async function readGovernance(ctx: PluginContext, companyId: string): Promise<GovernanceValidation> {
  try {
    const config = await ctx.config.get(companyId);
    return parseGovernanceConfig(config);
  } catch (error) {
    return {
      ok: false,
      config: { profileWriterAgentId: "", snapshotWriterAgentIds: [], allowBoardBackfill: false },
      errors: [`Could not read plugin governance configuration: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function governanceError(validation: GovernanceValidation) {
  return {
    status: 409,
    body: {
      error: "governance-not-configured",
      message: "Configure the company Knowledge Manager Agent id in Plugin Settings before writing the cockpit.",
      errors: validation.errors,
    },
  };
}

function writerError(decision: { allowed: boolean; message?: string }, action: "profile" | "snapshot", input: PluginApiRequestInput) {
  return {
    status: 403,
    body: {
      error: "writer-not-authorized",
      message: decision.message ?? `${action} writes are restricted to the company Knowledge Manager Agent.`,
      action,
      actor: input.actor.actorType === "agent" ? `agent:${input.actor.agentId ?? input.actor.actorId}` : `user:${input.actor.userId ?? input.actor.actorId}`,
    },
  };
}

async function saveProfileForCompany(
  ctx: PluginContext,
  companyId: string,
  input: unknown,
): Promise<BusinessProfile> {
  const validation = validateProfile(input);
  if (!validation.ok) {
    throw new Error(`Invalid cockpit profile: ${validation.errors.join("; ")}`);
  }
  await writeProfile(ctx, companyId, validation.profile);
  await logActivity(ctx, companyId, `Saved business cockpit profile "${validation.profile.name}".`, {
    resultCount: validation.profile.results.length,
    driverCount: validation.profile.drivers.length,
    linkCount: validation.profile.links.length,
  });
  return validation.profile;
}

async function ingestForCompany(
  ctx: PluginContext,
  companyId: string,
  values: IngestValue[],
  rejected: Array<{ id: string | null; reason: string; message?: string }>,
  reportedBy: string,
): Promise<{
  saved: number;
  savedIds: string[];
  rejected: Array<{ id: string | null; reason: string; message?: string }>;
  snapshotUpdatedAt: string;
}> {
  const now = Date.now();
  const previous = await readSnapshot(ctx, companyId);
  const merged: Record<string, SnapshotValue> = { ...(previous?.values ?? {}) };
  for (const entry of values) {
    merged[entry.id] = {
      value: entry.value,
      asOf: entry.asOf,
      source: entry.source ?? "snapshot",
      commit: entry.commit ?? null,
      digest: entry.digest ?? null,
      note: entry.note ?? null,
      reportedBy,
      reportedAt: new Date(now).toISOString(),
    };
  }
  const snapshot: Snapshot = {
    schema: "paperclip.business-status.snapshot/v1",
    updatedAt: new Date(now).toISOString(),
    values: merged,
  };
  await writeSnapshot(ctx, companyId, snapshot);
  await logActivity(
    ctx,
    companyId,
    `Ingested ${values.length} business cockpit metric value(s): ${values.map((entry) => entry.id).join(", ")}.`,
    {
      saved: values.map((entry) => ({
        id: entry.id,
        value: entry.value,
        asOf: entry.asOf,
        source: entry.source ?? null,
        commit: entry.commit ?? null,
        digest: entry.digest ?? null,
      })),
      rejected,
      reportedBy,
    },
  );
  return {
    saved: values.length,
    savedIds: values.map((entry) => entry.id),
    rejected,
    snapshotUpdatedAt: snapshot.updatedAt,
  };
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    pluginContext = ctx;

    ctx.data.register("business-status", async (params) => {
      const companyId = String(params.companyId ?? "");
      if (!companyId) throw new Error("companyId is required");
      return buildForCompany(ctx, companyId);
    });

    ctx.actions.register("save-profile", async (params, context) => {
      const companyId = String(params.companyId ?? context.companyId ?? "");
      if (!companyId) throw new Error("companyId is required");
      const governance = await readGovernance(ctx, companyId);
      if (!governance.ok) {
        throw new Error(`governance-not-configured: ${governance.errors.join("; ")}`);
      }
      const decision = writerDecision(
        governance.config,
        { type: context.actor.type === "agent" ? "agent" : "user", agentId: context.actor.agentId },
        "profile",
      );
      if (!decision.allowed) {
        throw new Error(`writer-not-authorized: ${decision.message}`);
      }
      const profile = await saveProfileForCompany(ctx, companyId, params.profile);
      return { companyId, profile };
    });

    ctx.logger.info("business-status plugin ready", { pluginId: PLUGIN_ID });
  },

  async onValidateConfig(config: Record<string, unknown>) {
    const validation = parseGovernanceConfig(config);
    return validation.ok ? { ok: true } : { ok: false, errors: validation.errors };
  },

  async onApiRequest(input: PluginApiRequestInput) {
    const ctx = requireContext();
    const companyId = input.companyId;
    if (!companyId) return { status: 400, body: { error: "companyId is required" } };

    if (input.routeKey === "overview") {
      return { body: await buildForCompany(ctx, companyId) };
    }

    if (input.routeKey === "ingest-metrics") {
      const governance = await readGovernance(ctx, companyId);
      if (!governance.ok) return governanceError(governance);
      const decision = writerDecision(
        governance.config,
        { type: input.actor.actorType, agentId: input.actor.agentId },
        "snapshot",
      );
      if (!decision.allowed) return writerError(decision, "snapshot", input);
      const profile = await readProfile(ctx, companyId);
      if (!profile) {
        return { status: 400, body: { error: "configure a cockpit profile before ingesting metric values" } };
      }
      const allowedIds = snapshotIdsForProfile(profile);
      const knownSources = metricSourcesForProfile(profile);
      const { values, rejected } = parseSnapshotValues(input.body, allowedIds, knownSources);
      if (values.length === 0) {
        return { status: 400, body: { error: "no valid metric values supplied", rejected } };
      }
      const result = await ingestForCompany(ctx, companyId, values, rejected, actorLabel(input));
      return { status: 201, body: result };
    }

    if (input.routeKey === "save-profile") {
      const governance = await readGovernance(ctx, companyId);
      if (!governance.ok) return governanceError(governance);
      const decision = writerDecision(
        governance.config,
        { type: input.actor.actorType, agentId: input.actor.agentId },
        "profile",
      );
      if (!decision.allowed) return writerError(decision, "profile", input);
      const body = (input.body ?? {}) as { profile?: unknown };
      try {
        const profile = await saveProfileForCompany(ctx, companyId, body.profile);
        return { status: 200, body: { companyId, profile } };
      } catch (error) {
        return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
      }
    }

    return { status: 404, body: { error: `unknown route: ${input.routeKey}` } };
  },

  async onHealth() {
    return { status: "ok", message: "business-status plugin ready" };
  },

  async onIdleDrain() {
    return "none";
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
