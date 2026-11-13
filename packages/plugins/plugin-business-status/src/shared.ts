export const PLUGIN_ID = "paperclip.business-status";
export const PLUGIN_VERSION = "1.1.1";
export const STATUS_ROUTE_PATH = "business-status";

export const PROFILE_NAMESPACE = "profile";
export const PROFILE_KEY = "active";
export const METRICS_NAMESPACE = "metrics";
export const METRICS_KEY = "snapshot";

export type MetricUnit = "ratio" | "count" | "days" | "currency" | "score";
export type MetricDirection = "higher-is-better" | "lower-is-better";
export type MetricStatus = "ok" | "warn" | "critical" | "unknown";
export type MetricState = "current" | "awaiting-data";
export type MetricSource = "paperclip" | "snapshot" | "static";

export interface MetricDefinition {
  id: string;
  label: string;
  unit: MetricUnit;
  direction: MetricDirection;
  target: number | null;
  warn: number | null;
  critical: number | null;
  source: MetricSource;
  sourceRef?: string;
  formula?: string;
  value?: number | null;
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
