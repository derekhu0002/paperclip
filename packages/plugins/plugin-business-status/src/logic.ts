import {
  PLUGIN_ID,
  PLUGIN_VERSION,
  STATUS_ROUTE_PATH,
  evaluateStatus,
  formatMetricValue,
  normalizedGap,
  type BusinessProfile,
  type CockpitPayload,
  type DriverValue,
  type MetricDefinition,
  type MetricProvenance,
  type MetricSource,
  type MetricStatus,
  type MetricValue,
  type Snapshot,
  type SnapshotValue,
} from "./shared.js";

export interface IssueLike {
  id: string;
  status: string;
  priority?: string;
  goalId?: string | null;
  createdAt: Date | string;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  blockedTransitionAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface GoalLike {
  id: string;
  status: string;
}

export interface AgentLike {
  id: string;
  status: string;
  budgetMonthlyCents?: number | null;
  spentMonthlyCents?: number | null;
}

export interface PaperclipInput {
  issues: IssueLike[];
  goals: GoalLike[];
  agents: AgentLike[];
  now: number;
}

export interface ComputedMetric {
  value: number | null;
  asOf: string;
  formula: string;
  source: string;
}

export type ComputedMetrics = Record<string, ComputedMetric>;

function time(value: Date | string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function withinDays(value: Date | string | null | undefined, now: number, days: number): boolean {
  const parsed = time(value);
  return parsed != null && now - parsed <= days * 86_400_000;
}

export function computePaperclipMetrics(input: PaperclipInput): ComputedMetrics {
  const { issues, goals, agents, now } = input;
  const asOf = new Date(now).toISOString();

  const activeGoalIds = new Set(goals.filter((goal) => goal.status === "active").map((goal) => goal.id));
  const goalIssues = issues.filter((issue) => issue.goalId && activeGoalIds.has(issue.goalId));
  const goalDone = goalIssues.filter((issue) => issue.status === "done").length;
  const goalProgress = goalIssues.length === 0 ? null : goalDone / goalIssues.length;

  const doneIssues = issues.filter((issue) => issue.status === "done" && withinDays(issue.completedAt, now, 30));
  const deliveryThroughput = doneIssues.length;

  const cycleDays = doneIssues
    .map((issue) => {
      const start = time(issue.startedAt) ?? time(issue.createdAt);
      const end = time(issue.completedAt);
      return start != null && end != null && end >= start ? (end - start) / 86_400_000 : null;
    })
    .filter((value): value is number => value != null);
  const cycleTime = median(cycleDays);

  const budgetAgents = agents.filter((agent) => agent.status !== "terminated");
  const budget = budgetAgents.reduce((sum, agent) => sum + (agent.budgetMonthlyCents ?? 0), 0);
  const spent = budgetAgents.reduce((sum, agent) => sum + (agent.spentMonthlyCents ?? 0), 0);
  const budgetBurn = budget > 0 ? spent / budget : null;

  const blockedIssues = issues.filter((issue) => issue.status === "blocked");
  const riskBlocked = blockedIssues.length;

  const wip = issues.filter((issue) => issue.status === "in_progress").length;

  const queueAges = issues
    .filter((issue) => issue.status === "todo")
    .map((issue) => {
      const created = time(issue.createdAt);
      return created == null ? null : Math.max(0, (now - created) / 86_400_000);
    })
    .filter((value): value is number => value != null);
  const queueAge = median(queueAges);

  const blockedAge = blockedIssues.filter((issue) => {
    const since = time(issue.blockedTransitionAt) ?? time(issue.updatedAt) ?? time(issue.createdAt);
    return since != null && now - since > 3 * 86_400_000;
  }).length;

  const reviewQueue = issues.filter((issue) => issue.status === "in_review").length;

  const availableAgents = budgetAgents.filter((agent) => agent.status === "idle" || agent.status === "running").length;
  const agentAvailability = budgetAgents.length === 0 ? null : availableAgents / budgetAgents.length;

  const costPerDelivery = deliveryThroughput === 0 ? null : spent / 100 / deliveryThroughput;

  return {
    "goal-progress": {
      value: goalProgress,
      asOf,
      source: "paperclip.goals+issues",
      formula: "Done issues under active goals / all issues under active goals",
    },
    "delivery-throughput": {
      value: deliveryThroughput,
      asOf,
      source: "paperclip.issues",
      formula: "Issues completed in the last 30 days",
    },
    "cycle-time": {
      value: cycleTime,
      asOf,
      source: "paperclip.issues",
      formula: "Median completedAt - startedAt for issues completed in the last 30 days",
    },
    "budget-burn": {
      value: budgetBurn,
      asOf,
      source: "paperclip.agents",
      formula: "sum(agent spentMonthlyCents) / sum(agent budgetMonthlyCents)",
    },
    "risk-blocked": {
      value: riskBlocked,
      asOf,
      source: "paperclip.issues",
      formula: "Issues currently blocked",
    },
    wip: {
      value: wip,
      asOf,
      source: "paperclip.issues",
      formula: "Issues currently in progress",
    },
    "queue-age": {
      value: queueAge,
      asOf,
      source: "paperclip.issues",
      formula: "Median age of todo issues since createdAt",
    },
    "blocked-age": {
      value: blockedAge,
      asOf,
      source: "paperclip.issues",
      formula: "Issues blocked for more than 3 days",
    },
    "review-queue": {
      value: reviewQueue,
      asOf,
      source: "paperclip.issues",
      formula: "Issues currently in review",
    },
    "agent-availability": {
      value: agentAvailability,
      asOf,
      source: "paperclip.agents",
      formula: "Idle or running agents / non-terminated agents",
    },
    "cost-per-delivery": {
      value: costPerDelivery,
      asOf,
      source: "paperclip.agents+issues",
      formula: "Agent monthly spend in USD / issues completed in the last 30 days",
    },
  };
}

function provenanceFor(
  definition: MetricDefinition,
  computed: ComputedMetrics,
  snapshot: Snapshot | null,
): { value: number | null; asOf: string | null; provenance: MetricProvenance } {
  if (definition.source === "paperclip") {
    const key = definition.sourceRef ?? definition.id;
    const metric = computed[key];
    return {
      value: metric?.value ?? null,
      asOf: metric?.asOf ?? null,
      provenance: {
        source: metric?.source ?? "paperclip",
        sourceRef: key,
        formula: metric?.formula ?? definition.formula ?? null,
        asOf: metric?.asOf ?? null,
      },
    };
  }
  if (definition.source === "snapshot") {
    const key = definition.sourceRef ?? definition.id;
    const stored = snapshot?.values?.[key] ?? null;
    if (!stored) {
      return {
        value: null,
        asOf: null,
        provenance: {
          source: "snapshot",
          sourceRef: key,
          formula: definition.formula ?? null,
          note: "No snapshot has been ingested for this metric; it is not filled with 0 or guessed.",
        },
      };
    }
    return {
      value: stored.value,
      asOf: stored.asOf,
      provenance: {
        source: stored.source ?? "snapshot",
        sourceRef: key,
        formula: definition.formula ?? null,
        note: stored.note ?? null,
        asOf: stored.asOf,
        commit: stored.commit ?? null,
        digest: stored.digest ?? null,
        reportedBy: stored.reportedBy ?? null,
      },
    };
  }
  return {
    value: definition.value ?? null,
    asOf: null,
    provenance: {
      source: "static",
      formula: definition.formula ?? null,
    },
  };
}

interface ResolvedMetric {
  value: number | null;
  asOf: string | null;
  provenance: MetricProvenance;
}

function aggregationDescription(definition: MetricDefinition): string {
  const ids = (definition.inputs ?? []).map((input) => input.id);
  if (definition.aggregation === "weighted-sum") {
    return `Weighted sum of ${ids.join(", ")}.`;
  }
  if (definition.aggregation === "average") return `Average of ${ids.join(", ")}.`;
  if (definition.aggregation === "min") return `Minimum of ${ids.join(", ")}.`;
  if (definition.aggregation === "max") return `Maximum of ${ids.join(", ")}.`;
  if (definition.aggregation === "ratio") return "Numerator / denominator.";
  return `Sum of ${ids.join(", ")}.`;
}

function aggregateComputedValue(
  definition: MetricDefinition,
  entries: Array<{ input: NonNullable<MetricDefinition["inputs"]>[number]; resolved: ResolvedMetric }>,
): { value: number | null; note: string | null } {
  const inputs = definition.inputs ?? [];
  if (inputs.length === 0) {
    return { value: null, note: "Computed metric has no inputs; it stays awaiting-data." };
  }
  const missing = entries.filter((entry) => entry.resolved.value == null).map((entry) => entry.input.id);
  if (missing.length > 0) {
    return { value: null, note: `Awaiting input value(s): ${missing.join(", ")}.` };
  }
  const values = entries.map((entry) => entry.resolved.value as number);
  let value: number | null = null;
  let note: string | null = null;
  switch (definition.aggregation) {
    case "weighted-sum":
      value = entries.reduce((sum, entry) => sum + (entry.resolved.value as number) * (entry.input.weight ?? 1), 0);
      break;
    case "average":
      value = values.reduce((sum, entry) => sum + entry, 0) / values.length;
      break;
    case "min":
      value = Math.min(...values);
      break;
    case "max":
      value = Math.max(...values);
      break;
    case "ratio": {
      const numerator = entries.find((entry) => entry.input.role === "numerator")?.resolved.value;
      const denominator = entries.find((entry) => entry.input.role === "denominator")?.resolved.value;
      if (numerator == null || denominator == null) {
        note = "Ratio requires one numerator and one denominator input.";
      } else if (denominator === 0) {
        note = "Ratio denominator is zero; the metric stays awaiting-data.";
      } else {
        value = numerator / denominator;
      }
      break;
    }
    case "sum":
    default:
      value = values.reduce((sum, entry) => sum + entry, 0);
      break;
  }
  if (value != null && !Number.isFinite(value)) {
    return { value: null, note: "Computed value is not finite; the metric stays awaiting-data." };
  }
  return { value, note };
}

function resolveDefinitionValue(
  definition: MetricDefinition,
  computed: ComputedMetrics,
  snapshot: Snapshot | null,
  byId: Map<string, MetricDefinition>,
  cache: Map<string, ResolvedMetric>,
  visiting: Set<string>,
): ResolvedMetric {
  const cached = cache.get(definition.id);
  if (cached) return cached;
  if (definition.source !== "computed") {
    const resolved = provenanceFor(definition, computed, snapshot);
    cache.set(definition.id, resolved);
    return resolved;
  }
  if (visiting.has(definition.id)) {
    return {
      value: null,
      asOf: null,
      provenance: {
        source: "computed",
        formula: definition.formula ?? null,
        note: "Cycle detected while resolving computed metric; it stays awaiting-data.",
      },
    };
  }
  visiting.add(definition.id);
  const entries = (definition.inputs ?? []).map((input) => {
    const inputDefinition = byId.get(input.id);
    const resolved = inputDefinition
      ? resolveDefinitionValue(inputDefinition, computed, snapshot, byId, cache, visiting)
      : {
          value: null,
          asOf: null,
          provenance: { source: null, note: `Input ${input.id} is not defined in this profile.` },
        };
    return { input, resolved };
  });
  const aggregated = aggregateComputedValue(definition, entries);
  const asOf = latestAsOf(entries.map((entry) => entry.resolved.asOf));
  const resolved: ResolvedMetric = {
    value: aggregated.value,
    asOf,
    provenance: {
      source: "computed",
      formula: definition.formula ?? aggregationDescription(definition),
      note: aggregated.note ?? `Computed from ${entries.length} input(s).`,
      asOf,
    },
  };
  visiting.delete(definition.id);
  cache.set(definition.id, resolved);
  return resolved;
}

function toMetricValue(definition: MetricDefinition, resolved: ResolvedMetric): MetricValue {
  const { value, asOf, provenance } = resolved;
  const state = value == null ? "awaiting-data" : "current";
  return {
    definition,
    value,
    displayValue: formatMetricValue(value, definition.unit),
    status: evaluateStatus(definition, value),
    state,
    asOf,
    provenance,
    gapRatio: normalizedGap(definition, value),
  };
}

export function mergeProfile(
  profile: BusinessProfile,
  computed: ComputedMetrics,
  snapshot: Snapshot | null,
): { results: MetricValue[]; drivers: DriverValue[] } {
  const definitions = [...profile.results, ...profile.drivers];
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const cache = new Map<string, ResolvedMetric>();
  const resolve = (definition: MetricDefinition) =>
    resolveDefinitionValue(definition, computed, snapshot, byId, cache, new Set());
  const results = profile.results.map((definition) => toMetricValue(definition, resolve(definition)));
  const resultById = new Map(results.map((result) => [result.definition.id, result]));
  const drivers: DriverValue[] = profile.drivers.map((definition) => {
    const base = toMetricValue(definition, resolve(definition));
    const impacts = profile.links
      .filter((link) => link.from === definition.id)
      .map((link) => {
        const result = resultById.get(link.to);
        const impact =
          base.gapRatio == null || result == null ? 0 : base.gapRatio * Math.abs(link.weight);
        return {
          resultId: link.to,
          weight: link.weight,
          impact: Number(impact.toFixed(4)),
          gapRatio: base.gapRatio,
        };
      });
    return { ...base, affects: definition.affects, impacts };
  });
  return { results, drivers };
}

export function leverRanking(drivers: DriverValue[]): CockpitPayload["levers"] {
  return drivers
    .map((driver) => {
      const impact = driver.impacts.reduce((max, entry) => Math.max(max, entry.impact), 0);
      return {
        driverId: driver.definition.id,
        label: driver.definition.label,
        value: driver.value,
        displayValue: driver.displayValue,
        target: driver.definition.target,
        status: driver.status,
        impact: Number(impact.toFixed(4)),
        results: driver.impacts.map((impactEntry) => impactEntry.resultId),
      };
    })
    .filter((lever) => lever.impact > 0)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 5);
}

export function latestAsOf(values: Array<string | null>): string | null {
  let latest: number | null = null;
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && (latest == null || parsed > latest)) latest = parsed;
  }
  return latest == null ? null : new Date(latest).toISOString();
}

export function buildCockpitPayload(
  profile: BusinessProfile | null,
  computed: ComputedMetrics,
  snapshot: Snapshot | null,
  now: number,
  companyId: string,
): CockpitPayload {
  const snapshotInfo = {
    updatedAt: snapshot?.updatedAt ?? null,
    valueCount: snapshot ? Object.keys(snapshot.values ?? {}).length : 0,
    ingestRoute: `/api/plugins/${PLUGIN_ID}/api/metrics`,
    profileRoute: `/api/plugins/${PLUGIN_ID}/api/profile`,
  };
  if (!profile) {
    return {
      schema: "paperclip.business-status/v1",
      pluginId: PLUGIN_ID,
      pluginVersion: PLUGIN_VERSION,
      companyId,
      configured: false,
      profile: null,
      business: null,
      results: [],
      drivers: [],
      links: [],
      levers: [],
      generatedAt: new Date(now).toISOString(),
      asOf: null,
      snapshot: snapshotInfo,
    };
  }
  const { results, drivers } = mergeProfile(profile, computed, snapshot);
  const asOf = latestAsOf([...results, ...drivers].map((metric) => metric.asOf));
  return {
    schema: "paperclip.business-status/v1",
    pluginId: PLUGIN_ID,
    pluginVersion: PLUGIN_VERSION,
    companyId,
    configured: true,
    profile,
    business: {
      name: profile.name,
      description: profile.description ?? null,
    },
    results,
    drivers,
    links: profile.links,
    levers: leverRanking(drivers),
    generatedAt: new Date(now).toISOString(),
    asOf,
    snapshot: snapshotInfo,
  };
}

export interface IngestValue {
  id: string;
  value: number;
  asOf: string;
  source?: string;
  commit?: string;
  digest?: string;
  note?: string;
}

export interface RejectedValue {
  id: string | null;
  reason: string;
  message?: string;
}

export function parseSnapshotValues(
  body: unknown,
  allowedIds: Set<string>,
  knownSources: Map<string, MetricSource> = new Map(),
): { values: IngestValue[]; rejected: RejectedValue[] } {
  const rejected: RejectedValue[] = [];
  const values: IngestValue[] = [];
  const list = (body as { values?: unknown } | null)?.values;
  const rows = Array.isArray(list) ? list : [];
  for (const entry of rows) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : null;
    if (!id) {
      rejected.push({ id: null, reason: "missing-id", message: "Each value must include a non-empty metric id." });
      continue;
    }
    if (!allowedIds.has(id)) {
      const source = knownSources.get(id);
      if (source) {
        rejected.push({
          id,
          reason: "metric-not-ingestible",
          message: `Metric "${id}" is source="${source}". Only source="snapshot" metrics can be ingested; ${
            source === "computed"
              ? "computed metrics are derived from their inputs"
              : source === "paperclip"
                ? "paperclip metrics are computed by the host"
                : "static metrics are fixed in the profile"
          }.`,
        });
      } else {
        rejected.push({
          id,
          reason: "unknown-metric-id",
          message: `Metric "${id}" is not declared in the active profile. Add it to results/drivers or fix the id.`,
        });
      }
      continue;
    }
    const value = typeof record.value === "number" ? record.value : Number(record.value);
    if (record.value == null || !Number.isFinite(value)) {
      rejected.push({ id, reason: "invalid-value", message: "value must be a finite number." });
      continue;
    }
    const asOfRaw = record.asOf;
    const parsed = typeof asOfRaw === "string" ? Date.parse(asOfRaw) : Number.NaN;
    if (!Number.isFinite(parsed)) {
      rejected.push({ id, reason: "missing-or-invalid-asOf", message: "asOf must be an ISO-8601 timestamp." });
      continue;
    }
    values.push({
      id,
      value,
      asOf: new Date(parsed).toISOString(),
      source: typeof record.source === "string" ? record.source : undefined,
      commit: typeof record.commit === "string" ? record.commit : undefined,
      digest: typeof record.digest === "string" ? record.digest : undefined,
      note: typeof record.note === "string" ? record.note : undefined,
    });
  }
  return { values, rejected };
}

export function summarizeStates(results: MetricValue[]): { current: number; awaiting: number; total: number } {
  let current = 0;
  let awaiting = 0;
  for (const result of results) {
    if (result.state === "current") current += 1;
    else awaiting += 1;
  }
  return { current, awaiting, total: results.length };
}

export function statusTone(status: MetricStatus): "ok" | "warn" | "critical" | "unknown" {
  return status;
}

export { STATUS_ROUTE_PATH };


