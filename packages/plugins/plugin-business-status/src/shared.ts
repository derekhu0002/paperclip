export const PLUGIN_ID = "paperclip.business-status";
export const PLUGIN_VERSION = "1.8.0";
export const STATUS_ROUTE_PATH = "business-status";

export const PROFILE_NAMESPACE = "profile";
export const PROFILE_KEY = "active";
export const METRICS_NAMESPACE = "metrics";
export const METRICS_KEY = "snapshot";
export const DASHBOARD_NAMESPACE = "dashboard";
export const DASHBOARD_KEY = "layout";

export type MetricUnit = "ratio" | "count" | "days" | "currency" | "score";
export type MetricDirection = "higher-is-better" | "lower-is-better";
export type MetricStatus = "ok" | "warn" | "critical" | "unknown";
export type MetricState = "current" | "awaiting-data";
export type MetricSource = "paperclip" | "snapshot" | "static" | "computed";
export type MetricAggregation = "sum" | "weighted-sum" | "average" | "ratio" | "min" | "max";

export interface MetricInput {
  id: string;
  weight?: number;
  role?: "numerator" | "denominator";
  note?: string;
}

export interface MetricDefinition {
  id: string;
  label: string;
  description?: string;
  unit: MetricUnit;
  direction: MetricDirection;
  target: number | null;
  warn: number | null;
  critical: number | null;
  source: MetricSource;
  sourceRef?: string;
  formula?: string;
  value?: number | null;
  aggregation?: MetricAggregation;
  inputs?: MetricInput[];
}

export interface DriverDefinition extends MetricDefinition {
  affects: string[];
}

export interface CausalLink {
  from: string;
  to: string;
  weight: number;
  note?: string;
}

export interface BusinessProfile {
  name: string;
  description?: string;
  results: MetricDefinition[];
  drivers: DriverDefinition[];
  links: CausalLink[];
}

export interface MetricProvenance {
  source?: string | null;
  sourceRef?: string | null;
  formula?: string | null;
  note?: string | null;
  asOf?: string | null;
  commit?: string | null;
  digest?: string | null;
  reportedBy?: string | null;
}

export interface MetricValue {
  definition: MetricDefinition;
  value: number | null;
  displayValue: string | null;
  status: MetricStatus;
  state: MetricState;
  asOf: string | null;
  provenance: MetricProvenance;
  gapRatio: number | null;
}

export interface DriverValue extends MetricValue {
  affects: string[];
  impacts: Array<{ resultId: string; weight: number; impact: number; gapRatio: number | null }>;
}

export type DashboardColumnCount = 2 | 3 | 4 | 6;
export type MetricDisplay = "number" | "bar" | "bullet" | "gauge";
export type BoardViewMode = "cards" | "table";

/**
 * Company-scoped dashboard board configuration. `metricIds` is ordered and may
 * reference any result or driver in the active profile. An empty list hides
 * the board without uninstalling the widget.
 */
export interface DashboardLayout {
  version: 1;
  metricIds: string[];
  displays: Record<string, MetricDisplay>;
  columns: DashboardColumnCount;
  viewMode: BoardViewMode;
  showGroups: boolean;
  showTargets: boolean;
  showSource: boolean;
  showInfluence: boolean;
}

export const DEFAULT_DASHBOARD_COLUMNS: DashboardColumnCount = 4;
export const MAX_DASHBOARD_METRICS = 12;

export function isDashboardColumnCount(value: unknown): value is DashboardColumnCount {
  return value === 2 || value === 3 || value === 4 || value === 6;
}

export function defaultDashboardLayout(profile: BusinessProfile | null): DashboardLayout {
  const results = profile?.results ?? [];
  return {
    version: 1,
    metricIds: results.slice(0, MAX_DASHBOARD_METRICS).map((result) => result.id),
    displays: {},
    columns: DEFAULT_DASHBOARD_COLUMNS,
    viewMode: "cards",
    showGroups: true,
    showTargets: true,
    showSource: true,
    showInfluence: true,
  };
}

function driverImpact(entry: DriverValue): number {
  return entry.impacts.reduce((max, impact) => Math.max(max, Math.abs(impact.impact)), 0);
}

/**
 * First-run board content: all results plus the most relevant drivers (the ones
 * with the largest absolute impact on the configured results). This makes the
 * dashboard useful before anyone opens Customize, while "Reset" still returns
 * to results only.
 */
export function defaultDashboardLayoutFromPayload(payload: CockpitPayload): DashboardLayout {
  const rankedDrivers = [...payload.drivers]
    .filter((entry) => entry.impacts.some((impact) => impact.impact !== 0))
    .sort((a, b) => driverImpact(b) - driverImpact(a))
    .map((entry) => entry.definition.id);
  const fallbackDrivers = payload.drivers.map((entry) => entry.definition.id);
  const driverIds = (rankedDrivers.length > 0 ? rankedDrivers : fallbackDrivers).slice(0, 6);
  return {
    ...defaultDashboardLayout(payload.profile),
    metricIds: [
      ...payload.results.map((entry) => entry.definition.id),
      ...driverIds,
    ].slice(0, MAX_DASHBOARD_METRICS),
  };
}

function normalizeDisplays(input: unknown): Record<string, MetricDisplay> {
  if (!input || typeof input !== "object") return {};
  const displays: Record<string, MetricDisplay> = {};
  for (const [id, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === "number" || value === "bar" || value === "bullet" || value === "gauge") {
      displays[id] = value;
    }
  }
  return displays;
}

export function normalizeDashboardLayout(input: unknown): DashboardLayout | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const metricIds = Array.isArray(raw.metricIds)
    ? raw.metricIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  return {
    version: 1,
    metricIds: [...new Set(metricIds)],
    displays: normalizeDisplays(raw.displays),
    columns: isDashboardColumnCount(raw.columns) ? raw.columns : DEFAULT_DASHBOARD_COLUMNS,
    viewMode: raw.viewMode === "table" ? "table" : "cards",
    showGroups: raw.showGroups !== false,
    showTargets: raw.showTargets !== false,
    showSource: raw.showSource !== false,
    showInfluence: raw.showInfluence !== false,
  };
}

export function validateDashboardLayout(
  input: unknown,
  profile: BusinessProfile | null,
): { ok: true; layout: DashboardLayout } | { ok: false; errors: string[] } {
  const layout = normalizeDashboardLayout(input);
  if (!layout) return { ok: false, errors: ["dashboard layout must be an object"] };
  if (layout.metricIds.length > MAX_DASHBOARD_METRICS) {
    return { ok: false, errors: [`dashboard layout supports at most ${MAX_DASHBOARD_METRICS} metrics`] };
  }
  const known = new Set([
    ...(profile?.results ?? []).map((metric) => metric.id),
    ...(profile?.drivers ?? []).map((metric) => metric.id),
  ]);
  const unknown = layout.metricIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return { ok: false, errors: [`unknown metric ids: ${unknown.join(", ")}`] };
  }
  return { ok: true, layout };
}

export function resolveDashboardMetrics(
  payload: CockpitPayload | null,
  layout: DashboardLayout | null,
): { results: MetricValue[]; drivers: DriverValue[]; all: MetricValue[] } {
  if (!payload || !layout) return { results: [], drivers: [], all: [] };
  const resultsById = new Map(payload.results.map((entry) => [entry.definition.id, entry]));
  const driversById = new Map(payload.drivers.map((entry) => [entry.definition.id, entry]));
  const results: MetricValue[] = [];
  const drivers: DriverValue[] = [];
  const all: MetricValue[] = [];
  for (const id of layout.metricIds) {
    const result = resultsById.get(id);
    if (result) {
      results.push(result);
      all.push(result);
      continue;
    }
    const driver = driversById.get(id);
    if (driver) {
      drivers.push(driver);
      all.push(driver);
    }
  }
  return { results, drivers, all };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Normalized 0..1 fill for a single metric bar. Uses the target when present,
 * otherwise the nearest configured threshold; returns null when the profile
 * gives no usable scale, so the UI can fall back to a number.
 */
export function barProgress(entry: MetricValue): number | null {
  const { value } = entry;
  const { direction, target, warn, critical } = entry.definition;
  if (value == null || !Number.isFinite(value)) return null;
  if (direction === "higher-is-better") {
    if (target != null && target > 0) return clamp01(value / target);
    if (critical != null && critical > 0) return clamp01(value / critical);
    if (warn != null && warn > 0) return clamp01(value / warn);
    return null;
  }
  if (critical != null && critical > 0) return clamp01(1 - value / critical);
  if (warn != null && warn > 0) return clamp01(1 - value / warn);
  if (target != null && target > 0) return clamp01(target / Math.max(value, 0.0001));
  return null;
}

export interface InfluenceRow {
  driverId: string;
  driverLabel: string;
  resultId: string;
  resultLabel: string;
  weight: number;
  impact: number | null;
}

/**
 * Weighted driver-to-result edges for the selected results. The profile's
 * `links` are the causal edges; `impact` is the driver's current contribution
 * to the result gap when the cockpit computed one.
 */
export function buildInfluenceRows(payload: CockpitPayload | null, resultIds: string[]): InfluenceRow[] {
  if (!payload) return [];
  const resultSet = new Set(resultIds);
  const resultsById = new Map(payload.results.map((entry) => [entry.definition.id, entry]));
  const driversById = new Map(payload.drivers.map((entry) => [entry.definition.id, entry]));
  const rows: InfluenceRow[] = [];
  for (const link of payload.links) {
    if (!resultSet.has(link.to)) continue;
    const driver = driversById.get(link.from);
    const result = resultsById.get(link.to);
    if (!driver || !result) continue;
    rows.push({
      driverId: driver.definition.id,
      driverLabel: driver.definition.label,
      resultId: result.definition.id,
      resultLabel: result.definition.label,
      weight: link.weight,
      impact: driver.impacts.find((entry) => entry.resultId === link.to)?.impact ?? null,
    });
  }
  rows.sort((a, b) => {
    if (a.resultId !== b.resultId) return resultIds.indexOf(a.resultId) - resultIds.indexOf(b.resultId);
    return Math.abs(b.weight) - Math.abs(a.weight);
  });
  return rows;
}

export interface CockpitPayload {
  schema: "paperclip.business-status/v1";
  pluginId: string;
  pluginVersion: string;
  companyId: string;
  configured: boolean;
  profile: BusinessProfile | null;
  business: {
    name: string;
    description: string | null;
  } | null;
  results: MetricValue[];
  drivers: DriverValue[];
  links: CausalLink[];
  levers: Array<{
    driverId: string;
    label: string;
    value: number | null;
    displayValue: string | null;
    target: number | null;
    status: MetricStatus;
    impact: number;
    results: string[];
  }>;
  generatedAt: string;
  asOf: string | null;
  snapshot: {
    updatedAt: string | null;
    valueCount: number;
    ingestRoute: string;
    profileRoute: string;
  };
}

export interface SnapshotValue {
  value: number;
  asOf: string;
  source?: string;
  commit?: string | null;
  digest?: string | null;
  note?: string | null;
  reportedBy?: string | null;
  reportedAt?: string | null;
}

export interface Snapshot {
  schema: "paperclip.business-status.snapshot/v1";
  updatedAt: string;
  values: Record<string, SnapshotValue>;
}

export function formatMetricValue(value: number | null, unit: MetricUnit): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (unit === "ratio") return `${(value * 100).toFixed(1)}%`;
  if (unit === "days") return `${value.toFixed(1)}d`;
  if (unit === "currency") return `$${value.toFixed(2)}`;
  if (unit === "score") return value.toFixed(2);
  return `${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

export function evaluateStatus(
  definition: Pick<MetricDefinition, "direction" | "target" | "warn" | "critical">,
  value: number | null,
): MetricStatus {
  if (value == null || !Number.isFinite(value)) return "unknown";
  const better = definition.direction === "higher-is-better";
  const fails = (limit: number | null) => limit != null && (better ? value < limit : value > limit);
  if (fails(definition.critical)) return "critical";
  if (fails(definition.warn)) return "warn";
  return "ok";
}

export function normalizedGap(
  definition: Pick<MetricDefinition, "direction" | "target">,
  value: number | null,
): number | null {
  if (value == null || !Number.isFinite(value) || definition.target == null) return null;
  const target = definition.target;
  if (definition.direction === "higher-is-better") {
    if (target <= 0) return value >= target ? 0 : 1;
    return Math.max(0, (target - value) / Math.abs(target));
  }
  if (target === 0) return value <= 0 ? 0 : Math.min(1, value);
  return Math.max(0, (value - target) / Math.abs(target));
}

export function directionLabel(direction: MetricDirection): string {
  return direction === "higher-is-better" ? "Higher is better" : "Lower is better";
}

export function unitLabel(unit: MetricUnit): string {
  if (unit === "ratio") return "%";
  if (unit === "days") return "days";
  if (unit === "currency") return "USD";
  if (unit === "score") return "score";
  return "count";
}
