import type {
  BusinessProfile,
  CausalLink,
  DriverDefinition,
  MetricDefinition,
  MetricDirection,
  MetricSource,
  MetricUnit,
} from "./shared.js";

const UNITS: MetricUnit[] = ["ratio", "count", "days", "currency", "score"];
const DIRECTIONS: MetricDirection[] = ["higher-is-better", "lower-is-better"];
const SOURCES: MetricSource[] = ["paperclip", "snapshot", "static"];
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export const STARTER_PROFILE: BusinessProfile = {
  name: "New Cockpit",
  description: "Define the outcomes you are accountable for and the process drivers that move them.",
  results: [
    {
      id: "delivery-throughput",
      label: "Delivery Throughput (30d)",
      unit: "count",
      direction: "higher-is-better",
      target: 10,
      warn: 5,
      critical: 2,
      source: "paperclip",
      sourceRef: "delivery-throughput",
      formula: "Issues completed in the last 30 days.",
    },
  ],
  drivers: [
    {
      id: "wip",
      label: "Work in Progress",
      unit: "count",
      direction: "lower-is-better",
      target: 10,
      warn: 20,
      critical: 30,
      source: "paperclip",
      sourceRef: "wip",
      formula: "Issues currently in progress.",
      affects: ["delivery-throughput"],
    },
  ],
  links: [{ from: "wip", to: "delivery-throughput", weight: 0.3 }],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readNullableNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

interface MetricValidation {
  ok: boolean;
  metric?: MetricDefinition | DriverDefinition;
  errors: string[];
}

function validateMetric(input: unknown, kind: "result" | "driver", prefix: string): MetricValidation {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: [`${prefix}: must be an object`] };
  const id = readString(input.id);
  if (!id || !ID_PATTERN.test(id)) errors.push(`${prefix}.id must match ${ID_PATTERN}`);
  const label = readString(input.label);
  if (!label) errors.push(`${prefix}.label is required`);
  const unit = readString(input.unit);
  if (!unit || !UNITS.includes(unit as MetricUnit)) errors.push(`${prefix}.unit must be one of ${UNITS.join(", ")}`);
  const direction = readString(input.direction);
  if (!direction || !DIRECTIONS.includes(direction as MetricDirection)) {
    errors.push(`${prefix}.direction must be higher-is-better or lower-is-better`);
  }
  const source = readString(input.source);
  if (!source || !SOURCES.includes(source as MetricSource)) {
    errors.push(`${prefix}.source must be one of ${SOURCES.join(", ")}`);
  }
  const target = readNullableNumber(input.target);
  if (target == null) errors.push(`${prefix}.target must be a finite number`);
  if (input.target !== undefined && input.target !== null && !isFiniteNumber(input.target)) {
    errors.push(`${prefix}.target must be a finite number or null`);
  }
  const warn = readNullableNumber(input.warn);
  const critical = readNullableNumber(input.critical);
  if (input.warn !== undefined && input.warn !== null && !isFiniteNumber(input.warn)) {
    errors.push(`${prefix}.warn must be a finite number or null`);
  }
  if (input.critical !== undefined && input.critical !== null && !isFiniteNumber(input.critical)) {
    errors.push(`${prefix}.critical must be a finite number or null`);
  }
  const sourceRef = readString(input.sourceRef);
  if (source === "paperclip" && !sourceRef) errors.push(`${prefix}.sourceRef is required when source=paperclip`);
  const formula = readString(input.formula) ?? undefined;
  let value: number | null | undefined;
  if (source === "static") {
    if (!isFiniteNumber(input.value)) errors.push(`${prefix}.value is required when source=static`);
    else value = input.value;
  }
  let affects: string[] = [];
  if (kind === "driver") {
    const raw = input.affects;
    if (raw !== undefined) {
      if (!Array.isArray(raw) || !raw.every((entry) => typeof entry === "string" && entry.trim())) {
        errors.push(`${prefix}.affects must be an array of result ids`);
      } else {
        affects = [...new Set(raw.map((entry) => (entry as string).trim()))];
      }
    }
  }
  const rawInputs = input.inputs;
  let inputs: string[] | undefined;
  if (rawInputs !== undefined) {
    if (!Array.isArray(rawInputs) || !rawInputs.every((entry) => typeof entry === "string" && entry.trim())) {
      errors.push(`${prefix}.inputs must be an array of metric ids`);
    } else {
      const cleaned = [...new Set(rawInputs.map((entry) => (entry as string).trim()))];
      if (id && cleaned.includes(id)) errors.push(`${prefix}.inputs cannot reference its own metric id`);
      inputs = cleaned;
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const metric: MetricDefinition = {
    id: id!,
    label: label!,
    unit: unit as MetricUnit,
    direction: direction as MetricDirection,
    target: target!,
    warn,
    critical,
    source: source as MetricSource,
    ...(sourceRef ? { sourceRef } : {}),
    ...(formula ? { formula } : {}),
    ...(value !== undefined ? { value } : {}),
    ...(inputs && inputs.length > 0 ? { inputs } : {}),
  };
  return kind === "driver" ? { ok: true, metric: { ...metric, affects } as DriverDefinition, errors } : { ok: true, metric, errors };
}

function findInputCycle(metrics: MetricDefinition[]): string[] | null {
  const byId = new Map(metrics.map((metric) => [metric.id, metric]));
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  function visit(id: string): string[] | null {
    const current = state.get(id) ?? 0;
    if (current === 1) {
      return [...stack.slice(stack.indexOf(id)), id];
    }
    if (current === 2) return null;
    state.set(id, 1);
    stack.push(id);
    for (const inputId of byId.get(id)?.inputs ?? []) {
      if (!byId.has(inputId)) continue;
      const cycle = visit(inputId);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  }

  for (const metric of metrics) {
    const cycle = visit(metric.id);
    if (cycle) return cycle;
  }
  return null;
}

export function validateProfile(input: unknown): { ok: true; profile: BusinessProfile } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["profile must be an object"] };
  const name = readString(input.name);
  if (!name) errors.push("profile.name is required");
  const description = readString(input.description) ?? undefined;

  const resultsInput = Array.isArray(input.results) ? input.results : null;
  const driversInput = Array.isArray(input.drivers) ? input.drivers : null;
  const linksInput = Array.isArray(input.links) ? input.links : [];
  if (!resultsInput || resultsInput.length === 0) errors.push("profile.results must contain at least one result");
  if (!driversInput) errors.push("profile.drivers must be an array");

  const results: MetricDefinition[] = [];
  const drivers: DriverDefinition[] = [];
  const ids = new Set<string>();

  for (const [index, entry] of (resultsInput ?? []).entries()) {
    const validation = validateMetric(entry, "result", `results[${index}]`);
    errors.push(...validation.errors);
    if (validation.metric) {
      if (ids.has(validation.metric.id)) errors.push(`duplicate metric id: ${validation.metric.id}`);
      ids.add(validation.metric.id);
      results.push(validation.metric as MetricDefinition);
    }
  }
  for (const [index, entry] of (driversInput ?? []).entries()) {
    const validation = validateMetric(entry, "driver", `drivers[${index}]`);
    errors.push(...validation.errors);
    if (validation.metric) {
      if (ids.has(validation.metric.id)) errors.push(`duplicate metric id: ${validation.metric.id}`);
      ids.add(validation.metric.id);
      drivers.push(validation.metric as DriverDefinition);
    }
  }

  const resultIds = new Set(results.map((result) => result.id));
  const driverIds = new Set(drivers.map((driver) => driver.id));
  for (const driver of drivers) {
    for (const affect of driver.affects) {
      if (!resultIds.has(affect)) errors.push(`driver ${driver.id} affects unknown result ${affect}`);
    }
  }

  const allIds = new Set([...resultIds, ...driverIds]);
  for (const metric of [...results, ...drivers]) {
    for (const inputId of metric.inputs ?? []) {
      if (!allIds.has(inputId)) errors.push(`metric ${metric.id} has unknown input ${inputId}`);
    }
  }
  if (errors.length === 0) {
    const cycle = findInputCycle([...results, ...drivers]);
    if (cycle) errors.push(`profile.inputs contain a cycle: ${cycle.join(" -> ")}`);
  }

  const links: CausalLink[] = [];
  const linkKeys = new Set<string>();
  for (const [index, entry] of linksInput.entries()) {
    if (!isRecord(entry)) {
      errors.push(`links[${index}] must be an object`);
      continue;
    }
    const from = readString(entry.from);
    const to = readString(entry.to);
    const weight = isFiniteNumber(entry.weight) ? entry.weight : null;
    if (!from || !driverIds.has(from)) errors.push(`links[${index}].from must reference a driver id`);
    if (!to || !resultIds.has(to)) errors.push(`links[${index}].to must reference a result id`);
    if (weight == null || weight < -1 || weight > 1) errors.push(`links[${index}].weight must be between -1 and 1`);
    if (!from || !to || weight == null) continue;
    const key = `${from}->${to}`;
    if (linkKeys.has(key)) errors.push(`duplicate link: ${key}`);
    linkKeys.add(key);
    links.push({ from, to, weight, ...(readString(entry.note) ? { note: readString(entry.note)! } : {}) });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    profile: {
      name: name!,
      ...(description ? { description } : {}),
      results,
      drivers,
      links,
    },
  };
}

export function snapshotIdsForProfile(profile: BusinessProfile | null): Set<string> {
  const ids = new Set<string>();
  if (!profile) return ids;
  for (const metric of [...profile.results, ...profile.drivers]) {
    if (metric.source === "snapshot") ids.add(metric.sourceRef ?? metric.id);
  }
  return ids;
}
