import { Fragment, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  copyTextToClipboard,
  useHostNavigation,
  usePluginAction,
  usePluginData,
  type PluginPageProps,
  type PluginSidebarProps,
} from "@paperclipai/plugin-sdk/ui";
import {
  PLUGIN_ID,
  STATUS_ROUTE_PATH,
  MAX_DASHBOARD_METRICS,
  barProgress,
  buildInfluenceRows,
  defaultDashboardLayout,
  defaultDashboardLayoutFromPayload,
  directionLabel,
  formatMetricValue,
  resolveDashboardMetrics,
  type BusinessProfile,
  type CockpitPayload,
  type DashboardColumnCount,
  type DashboardLayout,
  type DriverValue,
  type InfluenceRow,
  type MetricDisplay,
  type MetricStatus,
  type MetricValue,
} from "../shared.js";
import { STARTER_PROFILE } from "../profile.js";

const C = {
  border: "var(--border, #2c2f36)",
  card: "var(--card, #171a1f)",
  bg: "var(--background, #101215)",
  fg: "var(--foreground, #eef1f5)",
  muted: "var(--muted-foreground, #98a2b3)",
  accent: "var(--accent, #232833)",
  primary: "var(--primary, #e8ecf2)",
  primaryFg: "var(--primary-foreground, #16181d)",
  ok: "#2da44e",
  warn: "#bf8700",
  critical: "var(--destructive, #cf222e)",
  info: "#3b82f6",
};

const card: CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: 16,
};

const mono: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 11,
};

const SIDEBAR_STYLES = `
.bc-sidebar-link { display: flex; align-items: center; gap: 10px; margin: 0 8px; padding: 6px 8px; border-radius: 8px; color: color-mix(in srgb, var(--foreground) 80%, transparent); text-decoration: none; font-size: inherit; font-weight: inherit; transition: background-color 120ms ease, color 120ms ease; }
.bc-sidebar-link:hover { background: var(--sidebar-accent); color: var(--sidebar-accent-foreground); }
.bc-sidebar-link[aria-current="page"] { background: var(--sidebar-accent); color: var(--sidebar-accent-foreground); }
@media (pointer: coarse) { .bc-sidebar-link { padding-top: 4px; padding-bottom: 4px; } }
`;

const BOARD_STYLES = `
.bc-board { display: flex; flex-direction: column; gap: 14px; }
.bc-board-grid { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 640px) { .bc-board-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1024px) { .bc-board-grid { grid-template-columns: repeat(var(--bc-columns, 4), minmax(0, 1fr)); } }
.bc-board-tile { border: 1px solid var(--border, #2c2f36); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.bc-board-label { color: var(--muted-foreground, #98a2b3); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
.bc-board-value { font-size: 22px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.bc-board-bar { height: 6px; border-radius: 999px; background: var(--muted); overflow: hidden; }
.bc-board-bar-fill { height: 100%; border-radius: 999px; }
.bc-board-bullet-track { position: relative; height: 10px; border-radius: 3px; background: var(--muted); }
.bc-board-bullet-fill { height: 100%; border-radius: 3px; }
.bc-board-bullet-target { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--foreground); border-radius: 1px; transform: translateX(-1px); }
.bc-board-gauge { display: flex; justify-content: center; }
.bc-board-meta { color: var(--muted-foreground, #98a2b3); font-size: 11px; line-height: 1.5; }
.bc-board-group-label { color: var(--muted-foreground, #98a2b3); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
.bc-board-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.bc-board-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.bc-board .bc-link-button { display: inline-flex; align-items: center; text-decoration: none; }
`;

function CockpitIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "none" }}
    >
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M12 18l4.2-6" />
      <circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function statusColor(status: MetricStatus): string {
  if (status === "ok") return C.ok;
  if (status === "warn") return C.warn;
  if (status === "critical") return C.critical;
  return C.muted;
}

function statusText(status: MetricStatus): string {
  if (status === "ok") return "On track";
  if (status === "warn") return "Watch";
  if (status === "critical") return "Critical";
  return "No data";
}

function badge(text: ReactNode, status: MetricStatus | "info" = "unknown"): ReactNode {
  const color = status === "info" ? C.info : statusColor(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 8px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        fontSize: 11,
        lineHeight: "18px",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function button(primary = false, disabled = false): CSSProperties {
  return {
    boxSizing: "border-box",
    minHeight: 32,
    whiteSpace: "nowrap",
    background: primary ? C.primary : "transparent",
    color: primary ? C.primaryFg : C.fg,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}

function shortTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toISOString().replace("T", " ").slice(0, 16) + "Z";
}

function targetText(metric: MetricValue): string {
  return formatMetricValue(metric.definition.target, metric.definition.unit) ?? "—";
}

function gapText(metric: MetricValue): string {
  if (metric.value == null || metric.definition.target == null) return "No target";
  const diff =
    metric.definition.direction === "higher-is-better"
      ? metric.definition.target - metric.value
      : metric.value - metric.definition.target;
  if (Math.abs(diff) < 1e-9) return "On target";
  const amount = formatMetricValue(Math.abs(diff), metric.definition.unit) ?? "";
  return diff > 0 ? `${amount} behind` : `${amount} ahead`;
}

function progressPercent(metric: MetricValue): number {
  if (metric.value == null || metric.definition.target == null) return 0;
  const target = Math.abs(metric.definition.target);
  if (target === 0) return metric.value === 0 ? 100 : 100;
  const ratio = metric.definition.direction === "higher-is-better" ? metric.value / target : target / Math.max(metric.value, 1e-9);
  return Math.max(0, Math.min(100, ratio * 100));
}

function impactFor(driver: DriverValue, resultId: string): number {
  return driver.impacts.find((impact) => impact.resultId === resultId)?.impact ?? 0;
}

type MetricEntry =
  | { role: "result"; value: MetricValue }
  | { role: "driver"; value: DriverValue };

function metricIndex(payload: CockpitPayload): Map<string, MetricEntry> {
  const index = new Map<string, MetricEntry>();
  for (const value of payload.results) index.set(value.definition.id, { role: "result", value });
  for (const value of payload.drivers) index.set(value.definition.id, { role: "driver", value });
  return index;
}

type MetricInputView = {
  entry: MetricEntry;
  weight?: number;
  role?: "numerator" | "denominator";
  note?: string;
  source: "input" | "link" | "affects";
};

function inputsFor(payload: CockpitPayload, index: Map<string, MetricEntry>, id: string): MetricInputView[] {
  const entry = index.get(id);
  if (!entry) return [];
  const views = new Map<string, MetricInputView>();

  for (const input of entry.value.definition.inputs ?? []) {
    const inputEntry = index.get(input.id);
    if (!inputEntry) continue;
    views.set(input.id, {
      entry: inputEntry,
      weight: input.weight,
      role: input.role,
      note: input.note,
      source: "input",
    });
  }

  if (entry.role === "result") {
    for (const link of payload.profile?.links ?? []) {
      if (link.to !== id) continue;
      const inputEntry = index.get(link.from);
      if (!inputEntry) continue;
      const existing = views.get(link.from);
      if (!existing) {
        views.set(link.from, { entry: inputEntry, weight: link.weight, note: link.note, source: "link" });
      } else if (existing.weight == null) {
        existing.weight = link.weight;
        existing.note = existing.note ?? link.note;
        existing.source = "link";
      }
    }
    for (const driver of payload.drivers) {
      if (!driver.affects.includes(id) || views.has(driver.definition.id)) continue;
      views.set(driver.definition.id, { entry: { role: "driver", value: driver }, source: "affects" });
    }
  }

  const result = [...views.values()];
  if (entry.role === "result") {
    result.sort((a, b) => Math.abs(b.weight ?? 0) - Math.abs(a.weight ?? 0));
  }
  return result;
}

function ResultCard({ result, onOpen }: { result: MetricValue; onOpen: () => void }) {
  const awaiting = result.state === "awaiting-data";
  const color = statusColor(result.status);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        ...card,
        textAlign: "left",
        cursor: "pointer",
        display: "grid",
        gap: 8,
        color: C.fg,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <span style={{ color: C.muted, fontSize: 12 }}>{result.definition.label}</span>
        {badge(awaiting ? "Awaiting data" : statusText(result.status), awaiting ? "unknown" : result.status)}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 650, fontVariantNumeric: "tabular-nums", color: awaiting ? C.muted : C.fg }}>
          {result.displayValue ?? "—"}
        </span>
        <span style={{ color: C.muted, fontSize: 11 }}>Target {targetText(result)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: C.muted, fontSize: 11 }}>
        <span>{gapText(result)}</span>
        <span>{result.asOf ? shortTime(result.asOf) : "No as-of"}</span>
      </div>
      <div style={{ height: 5, background: C.border, borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${progressPercent(result)}%`, height: "100%", background: color }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: C.info, fontSize: 11 }}>
        <span>Open calculation →</span>
      </div>
    </button>
  );
}

function InputCard({ input, impact, onOpen }: { input: MetricInputView; impact?: number; onOpen: () => void }) {
  const entry = input.entry;
  const metric = entry.value;
  const awaiting = metric.state === "awaiting-data";
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ ...card, textAlign: "left", cursor: "pointer", display: "grid", gap: 8, color: C.fg }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{metric.definition.label}</span>
        {badge(entry.role === "result" ? "Result" : "Driver", "info")}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 20, fontWeight: 650, fontVariantNumeric: "tabular-nums", color: awaiting ? C.muted : C.fg }}>
          {metric.displayValue ?? "—"}
        </span>
        <span style={{ color: C.muted, fontSize: 11 }}>Target {targetText(metric)}</span>
        <span style={{ color: C.muted, fontSize: 11 }}>{directionLabel(metric.definition.direction)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        {badge(awaiting ? "Awaiting data" : statusText(metric.status), awaiting ? "unknown" : metric.status)}
        <span style={{ color: C.muted, fontSize: 11 }}>
          {metric.provenance.source ?? "—"} · {shortTime(metric.asOf)}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11 }}>
        <span style={{ color: input.weight != null ? C.info : C.muted }}>
          {input.weight != null ? `Weight ${input.weight.toFixed(2)}` : "Weight not declared"}
          {input.role ? ` · ${input.role}` : ""}
        </span>
        <span style={{ color: C.muted }}>
          Gap ratio {metric.gapRatio == null ? "—" : metric.gapRatio.toFixed(2)}
        </span>
      </div>
      {impact != null ? <div style={{ color: C.info, fontSize: 11 }}>Impact {impact.toFixed(2)}</div> : null}
      {input.note ? <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.5 }}>{input.note}</div> : null}
      <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.5 }}>
        {metric.provenance.formula ?? metric.definition.formula ?? "No formula provided."}
      </div>
      <div style={{ color: C.info, fontSize: 11 }}>Open metric →</div>
    </button>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ color: C.muted, fontSize: 11 }}>{label}</span>
      <span style={{ fontSize: 12, textAlign: "right", overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

function metricMeaning(entry: MetricEntry): string {
  const definition = entry.value.definition;
  if (definition.description) return definition.description;
  const direction = definition.direction === "higher-is-better" ? "higher is better" : "lower is better";
  const target = formatMetricValue(definition.target, definition.unit) ?? "not set";
  const source = entry.value.provenance.source ?? definition.source;
  if (entry.role === "result") {
    return `${definition.label} is a final result the company is accountable for. It is measured in ${definition.unit}; ${direction}; target ${target}. It is currently sourced from ${source}. The inputs below show what is expected to move it.`;
  }
  const affects = entry.value.affects.length > 0 ? entry.value.affects.join(", ") : "no downstream result declared";
  return `${definition.label} is a process driver. It is measured in ${definition.unit}; ${direction}; target ${target}. It is expected to affect ${affects}. It is currently sourced from ${source}.`;
}

function MetricDetail({
  entry,
  inputs,
  pathEntries,
  onOpen,
  onBack,
  onHome,
  onJump,
}: {
  entry: MetricEntry;
  inputs: MetricInputView[];
  pathEntries: MetricEntry[];
  onOpen: (id: string) => void;
  onBack: () => void;
  onHome: () => void;
  onJump: (index: number) => void;
}) {
  const metric = entry.value;
  const definition = metric.definition;
  const awaiting = metric.state === "awaiting-data";
  const isDriver = entry.role === "driver";
  const affects = entry.role === "driver" ? entry.value.affects : [];
  const impacts = entry.role === "driver" ? entry.value.impacts : [];

  return (
    <>
      <nav style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 11 }}>
        <button type="button" style={{ ...button(), padding: "4px 9px" }} onClick={onBack}>
          ← Back
        </button>
        <button type="button" style={{ ...button(), padding: "4px 9px" }} onClick={onHome}>
          Business Cockpit
        </button>
        {pathEntries.map((pathEntry, index) => (
          <span key={`${pathEntry.value.definition.id}-${index}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: C.muted }}>/</span>
            <button type="button" style={{ ...button(), padding: "2px 7px" }} onClick={() => onJump(index)}>
              {pathEntry.value.definition.label}
            </button>
          </span>
        ))}
      </nav>

      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>{definition.label}</h1>
            {badge(isDriver ? "Driver" : "Result", "info")}
            {badge(awaiting ? "Awaiting data" : statusText(metric.status), awaiting ? "unknown" : metric.status)}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
            <span style={{ fontSize: 28, fontWeight: 650, fontVariantNumeric: "tabular-nums", color: awaiting ? C.muted : C.fg }}>
              {metric.displayValue ?? "—"}
            </span>
            <span style={{ color: C.muted, fontSize: 11 }}>
              Target {targetText(metric)} · {gapText(metric)}
            </span>
          </div>
          <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.6, margin: "8px 0 0", maxWidth: 760 }}>
            {metricMeaning(entry)}
          </p>
        </div>
        <div style={{ color: C.muted, fontSize: 11, textAlign: "right" }}>
          <div>as-of {shortTime(metric.asOf)}</div>
          <div>source {metric.provenance.source ?? "—"}</div>
        </div>
      </header>

      <section style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <div style={card}>
          <strong style={{ fontSize: 14 }}>Definition</strong>
          <div style={{ marginTop: 8 }}>
            <DetailRow label="Role" value={isDriver ? "Driver" : "Result"} />
            <DetailRow label="Unit" value={definition.unit} />
            <DetailRow label="Direction" value={directionLabel(definition.direction)} />
            <DetailRow label="Target" value={formatMetricValue(definition.target, definition.unit) ?? "—"} />
            <DetailRow label="Warn" value={formatMetricValue(definition.warn, definition.unit) ?? "—"} />
            <DetailRow label="Critical" value={formatMetricValue(definition.critical, definition.unit) ?? "—"} />
            <DetailRow label="Source" value={definition.source} />
            <DetailRow label="Source ref" value={definition.sourceRef ?? "—"} />
          </div>
        </div>

        <div style={card}>
          <strong style={{ fontSize: 14 }}>Calculation</strong>
          <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.6, margin: "8px 0 14px" }}>
            {definition.formula ?? metric.provenance.formula ?? "No formula provided."}
          </p>
          <strong style={{ fontSize: 14 }}>Provenance</strong>
          <div style={{ marginTop: 8 }}>
            <DetailRow label="Source" value={metric.provenance.source ?? definition.source} />
            <DetailRow label="Source ref" value={metric.provenance.sourceRef ?? definition.sourceRef ?? "—"} />
            {metric.provenance.commit ? <DetailRow label="Commit" value={<code style={mono}>{metric.provenance.commit}</code>} /> : null}
            {metric.provenance.digest ? <DetailRow label="Digest" value={<code style={mono}>{metric.provenance.digest}</code>} /> : null}
            {metric.provenance.note ? <DetailRow label="Note" value={metric.provenance.note} /> : null}
            {metric.provenance.reportedBy ? <DetailRow label="Reported by" value={metric.provenance.reportedBy} /> : null}
            <DetailRow label="As of" value={shortTime(metric.asOf)} />
          </div>
        </div>
      </section>

      <section style={card}>
        <strong style={{ fontSize: 14 }}>Input relationship</strong>
        <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.6, margin: "8px 0 10px" }}>
          Weights express how strongly each input moves this metric. A negative weight means the input moves it in the opposite direction. For <code style={{ color: C.info }}>computed</code> metrics, weights are formula coefficients for weighted-sum; for measured metrics they express influence. The displayed value is measured or derived from the declared source; this version does not recompute a snapshot value from inputs.
        </p>
        {inputs.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 12 }}>Leaf metric: no inputs influence this metric directly.</div>
        ) : (
          <div style={{ display: "grid", gap: 0 }}>
            {inputs.map((input) => {
              const impact = entry.role === "result" && input.entry.role === "driver" ? impactFor(input.entry.value, definition.id) : undefined;
              return (
                <div key={input.entry.value.definition.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, padding: "8px 0", borderTop: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 12 }}>
                    {input.entry.value.definition.label}
                    <span style={{ color: C.muted, fontSize: 11 }}> · {input.entry.role === "result" ? "result" : "driver"} · {directionLabel(input.entry.value.definition.direction)}{input.role ? ` · ${input.role}` : ""}</span>
                  </span>
                  <span style={{ color: input.weight != null ? C.info : C.muted, fontSize: 11, whiteSpace: "nowrap" }}>
                    {input.weight != null ? `weight ${input.weight.toFixed(2)}` : "weight not declared"}
                  </span>
                  <span style={{ gridColumn: "1 / -1", color: C.muted, fontSize: 11 }}>
                    {input.source === "link" ? "Weight from causal link." : input.source === "affects" ? "Input from affects; no weight." : "Weight from inputs."}
                    {` Gap ratio ${input.entry.value.gapRatio == null ? "—" : input.entry.value.gapRatio.toFixed(2)}.`}
                    {impact != null ? ` Impact ${impact.toFixed(2)}.` : ""}
                    {input.note ? ` ${input.note}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {isDriver ? (
        <section style={card}>
          <strong style={{ fontSize: 14 }}>Affects</strong>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {affects.length > 0
              ? affects.map((resultId) => <span key={resultId} style={{ ...mono, color: C.muted }}>{resultId}</span>)
              : <span style={{ color: C.muted, fontSize: 12 }}>No downstream result declared.</span>}
          </div>
          {impacts.length > 0 ? (
            <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
              {impacts.map((impact) => (
                <div key={impact.resultId} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted }}>
                  <span>{impact.resultId}</span>
                  <span>weight {impact.weight.toFixed(2)} · impact {impact.impact.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
          <strong style={{ fontSize: 14 }}>Inputs ({inputs.length})</strong>
          <span style={{ color: C.muted, fontSize: 11 }}>Click a card to inspect its definition, calculation and inputs.</span>
        </div>
        {inputs.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.6, marginTop: 10 }}>
            Leaf metric: no inputs are declared. This is where the measurement comes from.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", marginTop: 10 }}>
            {inputs.map((input) => {
              const impact = entry.role === "result" && input.entry.role === "driver" ? impactFor(input.entry.value, definition.id) : undefined;
              return <InputCard key={input.entry.value.definition.id} input={input} impact={impact} onOpen={() => onOpen(input.entry.value.definition.id)} />;
            })}
          </div>
        )}
      </section>
    </>
  );
}

function ConfigureDrawer({
  open,
  companyId,
  profile,
  onClose,
  onSaved,
}: {
  open: boolean;
  companyId: string;
  profile: BusinessProfile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const saveProfile = usePluginAction("save-profile");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText(JSON.stringify(profile ?? STARTER_PROFILE, null, 2));
    setError(null);
    setSaving(false);
  }, [open, profile]);

  if (!open) return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const parsed = JSON.parse(text) as BusinessProfile;
      await saveProfile({ companyId, profile: parsed });
      onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.4)", display: "flex", justifyContent: "flex-end" }}
      onClick={onClose}
    >
      <div
        style={{ width: "min(760px, 100%)", height: "100%", overflowY: "auto", background: C.card, borderLeft: `1px solid ${C.border}`, padding: 18, display: "grid", gap: 12, alignContent: "start" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CockpitIcon size={16} />
            <strong style={{ fontSize: 14 }}>Configure cockpit</strong>
          </div>
          <button type="button" onClick={onClose} style={{ ...button(), padding: "4px 9px", fontSize: 11 }}>
            Close
          </button>
        </div>
        <p style={{ color: C.muted, fontSize: 12, margin: 0, lineHeight: 1.6 }}>
          Edit the JSON profile for this company. The profile defines key results, process drivers, metric inputs, causal weights, targets and metric sources. It is stored per company; the Agent can also write it through{" "}
          <code style={{ color: C.info }}>POST /api/plugins/{PLUGIN_ID}/api/profile</code>.
        </p>
        <p style={{ color: C.muted, fontSize: 11, margin: 0, lineHeight: 1.6 }}>
          Writes are restricted to the company Knowledge Manager configured in Plugin Settings. If saving fails with governance-not-configured or writer-not-authorized, ask the board to set the writer agent id.
        </p>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          style={{
            width: "100%",
            minHeight: 460,
            resize: "vertical",
            background: C.bg,
            color: C.fg,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: 12,
            ...mono,
            lineHeight: 1.6,
          }}
        />
        {error ? <div style={{ color: C.critical, fontSize: 12, whiteSpace: "pre-wrap" }}>{error}</div> : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={button(true, saving)} disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save profile"}
          </button>
          <button type="button" style={button()} onClick={() => setText(JSON.stringify(STARTER_PROFILE, null, 2))}>
            Load example
          </button>
          <button type="button" style={button()} onClick={onClose}>
            Cancel
          </button>
        </div>
        <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.7 }}>
          Metric sources: <code style={{ color: C.info }}>paperclip</code> (computed by the host), <code style={{ color: C.info }}>snapshot</code> (ingested through the metrics API), <code style={{ color: C.info }}>static</code> (fixed value), <code style={{ color: C.info }}>computed</code> (derived from inputs by the plugin; not ingestible). Use <code style={{ color: C.info }}>inputs</code> to nest one metric under another. See the bundled business-cockpit skill for the full schema.
        </div>
      </div>
    </div>
  );
}

function EmptyState({ companyId, onConfigure }: { companyId: string; onConfigure: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  async function copyExample() {
    const example = `curl -sS -X POST "$PAPERCLIP_API_URL/api/plugins/${PLUGIN_ID}/api/profile" \\\n  -H "Authorization: Bearer <board-or-agent-token>" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ companyId, profile: STARTER_PROFILE })}'`;
    try {
      await copyTextToClipboard(example);
      setCopied("Copied profile API example");
    } catch {
      setCopied("Copy failed");
    }
  }
  return (
    <div style={{ padding: 20, background: C.bg, minHeight: "100%" }}>
      <section style={{ ...card, maxWidth: 860, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.muted, fontSize: 12 }}>
          <CockpitIcon size={16} />
          <span>Business Cockpit</span>
        </div>
        <h1 style={{ fontSize: 20, margin: 0 }}>No cockpit configured for this company</h1>
        <p style={{ color: C.muted, fontSize: 13, margin: 0, lineHeight: 1.7 }}>
          Define the key results you are accountable for and the process drivers that move them. You can edit the JSON profile yourself, or let an Agent design it through the API.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={button(true)} onClick={onConfigure}>
            Configure cockpit
          </button>
          <button type="button" style={button()} onClick={() => void copyExample()}>
            Copy profile API example
          </button>
        </div>
        {copied ? <span style={{ color: C.muted, fontSize: 11 }}>{copied}</span> : null}
        <div style={{ display: "grid", gap: 5, color: C.muted, fontSize: 12, lineHeight: 1.7, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
          <span><strong style={{ color: C.fg }}>Agent interface</strong></span>
          <span><code style={{ color: C.info }}>GET /api/plugins/{PLUGIN_ID}/api/overview?companyId=…</code> — read the cockpit.</span>
          <span><code style={{ color: C.info }}>POST /api/plugins/{PLUGIN_ID}/api/profile</code> — create or replace the profile.</span>
          <span><code style={{ color: C.info }}>POST /api/plugins/{PLUGIN_ID}/api/metrics</code> — ingest snapshot metric values.</span>
        </div>
      </section>
    </div>
  );
}

function Cockpit({
  payload,
  companyId,
  refresh,
  onConfigure,
}: {
  payload: CockpitPayload;
  companyId: string;
  refresh: () => void;
  onConfigure: () => void;
}) {
  const [path, setPath] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const { data: layoutData, refresh: refreshLayout } = usePluginData<{ layout: DashboardLayout | null }>(
    "dashboard-layout",
    { companyId },
  );
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const layout = useMemo(
    () => layoutData?.layout ?? defaultDashboardLayoutFromPayload(payload),
    [layoutData?.layout, payload],
  );
  const index = useMemo(() => metricIndex(payload), [payload]);
  useEffect(() => {
    if (path.length === 0) return;
    const valid = path.filter((id) => index.has(id));
    if (valid.length !== path.length) setPath(valid);
  }, [index, path]);
  const pathEntries = path.map((id) => index.get(id)).filter((entry): entry is MetricEntry => Boolean(entry));
  const focused = pathEntries[pathEntries.length - 1] ?? null;
  const inputs = focused ? inputsFor(payload, index, focused.value.definition.id) : [];

  async function copyExample() {
    const example = `curl -sS -X POST "$PAPERCLIP_API_URL/api/plugins/${PLUGIN_ID}/api/metrics" \\\n  -H "Authorization: Bearer <board-or-agent-token>" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ companyId, values: [{ id: "detection-coverage-rate", value: 0.62, asOf: new Date().toISOString(), source: "provider-graph", commit: "<sha>", digest: "sha256:<digest>" }] })}'`;
    try {
      await copyTextToClipboard(example);
      setCopied("Copied metrics API example");
    } catch {
      setCopied("Copy failed");
    }
  }

  return (
    <div style={{ padding: 20, display: "grid", gap: 14, background: C.bg, color: C.fg, minHeight: "100%" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 320 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.muted, fontSize: 11, marginBottom: 4 }}>
            <CockpitIcon size={14} />
            <span>Business Cockpit</span>
          </div>
          <h1 style={{ fontSize: 20, margin: 0 }}>{payload.business?.name ?? "Cockpit"}</h1>
          <p style={{ color: C.muted, fontSize: 12, margin: "6px 0 0", maxWidth: 780, lineHeight: 1.6 }}>
            {payload.business?.description ?? "Key results and the process drivers that move them."}
          </p>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {badge(`as-of ${shortTime(payload.asOf)}`, "info")}
            {badge(`generated ${shortTime(payload.generatedAt)}`, "unknown")}
            {badge(`${payload.results.length} results · ${payload.drivers.length} drivers`, "unknown")}
            {badge(`${payload.snapshot.valueCount} snapshot values`, "unknown")}
          </div>
        </div>
        <div style={{ display: "grid", gap: 6, justifyItems: "end", alignContent: "start", minWidth: 330, flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" style={button()} onClick={() => setCustomizeOpen(true)}>
              Customize board
            </button>
            <button type="button" style={button()} onClick={onConfigure}>
              Configure
            </button>
            <button type="button" style={button()} onClick={() => void copyExample()}>
              Copy metrics API example
            </button>
            <button type="button" style={button(true)} onClick={refresh}>
              Refresh
            </button>
          </div>
          <span style={{ color: C.muted, fontSize: 11, minHeight: 16, lineHeight: "16px" }}>{copied ?? ""}</span>
        </div>
      </header>

      {focused ? (
        <MetricDetail
          entry={focused}
          inputs={inputs}
          pathEntries={pathEntries}
          onOpen={(id) => setPath((current) => (current.includes(id) ? current : [...current, id]))}
          onBack={() => setPath((current) => current.slice(0, -1))}
          onHome={() => setPath([])}
          onJump={(position) => setPath((current) => current.slice(0, position + 1))}
        />
      ) : (
        <BusinessBoardBody
          payload={payload}
          layout={layout}
          onCustomize={() => setCustomizeOpen(true)}
          onOpen={(id) => setPath([id])}
        />
      )}

      <BoardCustomizeDrawer
        open={customizeOpen}
        companyId={companyId}
        payload={payload}
        layout={layout}
        onClose={() => setCustomizeOpen(false)}
        onSaved={refreshLayout}
      />
    </div>
  );
}

export function BusinessStatusPage({ context }: PluginPageProps) {
  const companyId = context.companyId ?? "";
  const { data, loading, error, refresh } = usePluginData<CockpitPayload>("business-status", { companyId });
  const [configureOpen, setConfigureOpen] = useState(false);

  if (!companyId) return <div style={{ ...card, color: C.muted }}>Select a company to open the cockpit.</div>;
  if (loading) return <div style={{ ...card, color: C.muted }}>Loading cockpit…</div>;
  if (error) {
    return (
      <div style={{ ...card, borderColor: C.critical }}>
        <div style={{ color: C.critical, fontWeight: 600 }}>Failed to load cockpit</div>
        <p style={{ color: C.muted, fontSize: 12 }}>{error.message}</p>
        <button type="button" style={button()} onClick={refresh}>Retry</button>
      </div>
    );
  }
  if (!data) return <div style={{ ...card, color: C.muted }}>No data to display.</div>;

  return (
    <>
      {data.configured ? (
        <Cockpit payload={data} companyId={companyId} refresh={refresh} onConfigure={() => setConfigureOpen(true)} />
      ) : (
        <EmptyState companyId={companyId} onConfigure={() => setConfigureOpen(true)} />
      )}
      <ConfigureDrawer
        open={configureOpen}
        companyId={companyId}
        profile={data.profile}
        onClose={() => setConfigureOpen(false)}
        onSaved={refresh}
      />
    </>
  );
}

export function BusinessStatusSidebarLink(_props: PluginSidebarProps) {
  const navigation = useHostNavigation();
  const href = navigation.resolveHref(`/${STATUS_ROUTE_PATH}`);
  const pathname = typeof window === "undefined" ? "" : window.location.pathname;
  const isActive = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <>
      <style>{SIDEBAR_STYLES}</style>
      <a
        {...navigation.linkProps(`/${STATUS_ROUTE_PATH}`)}
        className="bc-sidebar-link"
        aria-current={isActive ? "page" : undefined}
      >
        <span style={{ display: "inline-flex", flexShrink: 0 }}>
          <CockpitIcon size={16} />
        </span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Business Cockpit
        </span>
      </a>
    </>
  );
}

function overallStatus(results: MetricValue[]): MetricStatus {
  if (results.length === 0) return "unknown";
  if (results.some((result) => result.status === "critical")) return "critical";
  if (results.some((result) => result.status === "warn")) return "warn";
  if (results.every((result) => result.state === "awaiting-data")) return "unknown";
  return "ok";
}

function BulletBar({ entry }: { entry: MetricValue }) {
  const progress = barProgress(entry) ?? 0;
  const target = entry.definition.target;
  const scaleMax = Math.max(
    Math.abs(target ?? 0),
    Math.abs(entry.definition.warn ?? 0),
    Math.abs(entry.definition.critical ?? 0),
    Math.abs(entry.value ?? 0),
    1e-9,
  );
  const targetPct = target == null ? null : Math.min(100, Math.max(0, (Math.abs(target) / scaleMax) * 100));
  return (
    <div className="bc-board-bullet-track" aria-hidden="true">
      <div
        className="bc-board-bullet-fill"
        style={{ width: `${Math.round(progress * 100)}%`, background: statusColor(entry.status) }}
      />
      {targetPct != null ? <span className="bc-board-bullet-target" style={{ left: `${targetPct}%` }} /> : null}
    </div>
  );
}

function Gauge({ entry, size = 96 }: { entry: MetricValue; size?: number }) {
  const progress = barProgress(entry) ?? 0;
  const radius = (size - 16) / 2;
  const center = size / 2;
  const arcLength = Math.PI * radius;
  const color = statusColor(entry.status);
  const path = `M ${center - radius} ${center} A ${radius} ${radius} 0 0 1 ${center + radius} ${center}`;
  return (
    <div className="bc-board-gauge">
      <svg width={size} height={center + 12} viewBox={`0 0 ${size} ${center + 12}`} aria-hidden="true">
        <path d={path} fill="none" stroke="var(--muted)" strokeWidth={8} strokeLinecap="round" />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${arcLength * progress} ${arcLength}`}
        />
        <text
          x={center}
          y={center - 6}
          textAnchor="middle"
          fontSize={Math.max(12, size * 0.16)}
          fontWeight={600}
          fill="currentColor"
        >
          {entry.displayValue ?? "No data"}
        </text>
      </svg>
    </div>
  );
}

function BoardTile({
  entry,
  display,
  showTargets,
  showSource,
  onOpen,
}: {
  entry: MetricValue;
  display: MetricDisplay;
  showTargets: boolean;
  showSource: boolean;
  onOpen: () => void;
}) {
  const definition = entry.definition;
  const awaiting = entry.state === "awaiting-data";
  const progress = barProgress(entry);
  const meta: string[] = [];
  if (showTargets) {
    meta.push(definition.target == null ? "No target" : `Target ${targetText(entry)}`);
  }
  meta.push(directionLabel(definition.direction));
  if (entry.gapRatio != null) meta.push(`Gap ${(entry.gapRatio * 100).toFixed(0)}%`);
  if (showSource) meta.push(definition.source);
  if (entry.asOf) meta.push(`as-of ${shortTime(entry.asOf)}`);

  return (
    <div
      className="bc-board-tile"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      style={{ cursor: "pointer" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <span className="bc-board-label">{definition.label}</span>
        {badge(awaiting ? "Awaiting data" : statusText(entry.status), awaiting ? "unknown" : entry.status)}
      </div>
      {display === "gauge" ? (
        <Gauge entry={entry} />
      ) : (
        <div className="bc-board-value">{entry.displayValue ?? "No data"}</div>
      )}
      {display === "bar" && progress != null ? (
        <div className="bc-board-bar" aria-hidden="true">
          <div
            className="bc-board-bar-fill"
            style={{ width: `${Math.round(progress * 100)}%`, background: statusColor(entry.status) }}
          />
        </div>
      ) : null}
      {display === "bullet" ? <BulletBar entry={entry} /> : null}
      <div className="bc-board-meta">{meta.join(" · ")}</div>
    </div>
  );
}

const srOnly: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

function truncateLabel(text: string, max = 34): string {
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function InfluenceGraph({
  payload,
  resultIds,
  onOpen,
}: {
  payload: CockpitPayload;
  resultIds: string[];
  onOpen: (id: string) => void;
}) {
  const markerBase = useId().replace(/:/g, "");
  const [hover, setHover] = useState<{ row: InfluenceRow; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rows = buildInfluenceRows(payload, resultIds);
  if (rows.length === 0) return null;

  const driverIds: string[] = [];
  const graphResultIds: string[] = [];
  for (const row of rows) {
    if (!driverIds.includes(row.driverId)) driverIds.push(row.driverId);
    if (!graphResultIds.includes(row.resultId)) graphResultIds.push(row.resultId);
  }
  const drivers = driverIds
    .map((id) => payload.drivers.find((entry) => entry.definition.id === id))
    .filter((entry): entry is DriverValue => Boolean(entry));
  const results = graphResultIds
    .map((id) => payload.results.find((entry) => entry.definition.id === id))
    .filter((entry): entry is MetricValue => Boolean(entry));

  const width = 880;
  const rowHeight = 46;
  const top = 26;
  const height = Math.max(drivers.length, results.length) * rowHeight + top * 2;
  const driverX = 20;
  const driverW = 250;
  const resultW = 270;
  const resultX = width - 20 - resultW;
  const nodeH = 30;
  const maxWeight = Math.max(...rows.map((row) => Math.abs(row.weight)), 0.0001);

  const centerY = (count: number, index: number) =>
    top + (height - top * 2 - count * rowHeight) / 2 + rowHeight / 2 + index * rowHeight;
  const driverY = new Map(drivers.map((entry, index) => [entry.definition.id, centerY(drivers.length, index)]));
  const resultY = new Map(results.map((entry, index) => [entry.definition.id, centerY(results.length, index)]));

  function showTooltip(row: InfluenceRow, event: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ row, x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="bc-board-group-label">Driver influence</div>
      <div
        ref={containerRef}
        style={{ position: "relative", overflowX: "auto" }}
        onMouseLeave={() => setHover(null)}
      >
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Driver influence graph"
          style={{ minWidth: 640, display: "block" }}
        >
          <defs>
            <marker id={`${markerBase}-pos`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill={C.ok} />
            </marker>
            <marker id={`${markerBase}-neg`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill={C.critical} />
            </marker>
          </defs>

          {rows.map((row) => {
            const y1 = driverY.get(row.driverId);
            const y2 = resultY.get(row.resultId);
            if (y1 == null || y2 == null) return null;
            const x1 = driverX + driverW;
            const x2 = resultX;
            const mid = (x1 + x2) / 2;
            const positive = row.weight >= 0;
            const color = positive ? C.ok : C.critical;
            const path = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
            const active = hover?.row === row;
            return (
              <g key={`${row.driverId}:${row.resultId}`}>
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5 + (Math.abs(row.weight) / maxWeight) * 4}
                  strokeOpacity={active ? 1 : 0.5}
                  markerEnd={`url(#${markerBase}-${positive ? "pos" : "neg"})`}
                  pointerEvents="none"
                />
                <path
                  d={path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(event) => showTooltip(row, event)}
                  onMouseMove={(event) => showTooltip(row, event)}
                />
              </g>
            );
          })}

          {drivers.map((entry) => {
            const y = driverY.get(entry.definition.id);
            if (y == null) return null;
            return (
              <g key={entry.definition.id} transform={`translate(${driverX}, ${y - nodeH / 2})`}>
                <rect width={driverW} height={nodeH} rx={6} fill={C.card} stroke={C.border} />
                <text x={10} y={nodeH / 2 + 4} fontSize={11} fill={C.fg}>
                  {truncateLabel(entry.definition.label)}
                </text>
                <text x={driverW - 10} y={nodeH / 2 + 4} textAnchor="end" fontSize={11} fill={C.muted}>
                  {entry.displayValue ?? ""}
                </text>
              </g>
            );
          })}

          {results.map((entry) => {
            const y = resultY.get(entry.definition.id);
            if (y == null) return null;
            return (
              <g
                key={entry.definition.id}
                transform={`translate(${resultX}, ${y - nodeH / 2})`}
                role="button"
                tabIndex={0}
                aria-label={`Open ${entry.definition.label}`}
                style={{ cursor: "pointer" }}
                onClick={() => onOpen(entry.definition.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(entry.definition.id);
                  }
                }}
              >
                <rect width={resultW} height={nodeH} rx={6} fill={C.accent} stroke={C.border} />
                <text x={10} y={nodeH / 2 + 4} fontSize={11} fill={C.fg}>
                  {truncateLabel(entry.definition.label, 36)}
                </text>
                <text x={resultW - 10} y={nodeH / 2 + 4} textAnchor="end" fontSize={11} fill={C.muted}>
                  {entry.displayValue ?? ""}
                </text>
              </g>
            );
          })}
        </svg>

        {hover ? (
          <div
            style={{
              position: "absolute",
              left: hover.x + 12,
              top: hover.y + 12,
              zIndex: 2,
              pointerEvents: "none",
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "8px 10px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
              maxWidth: 300,
            }}
          >
            <div style={{ fontSize: 11, color: C.muted }}>
              {hover.row.driverLabel} → {hover.row.resultLabel}
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: hover.row.weight >= 0 ? C.ok : C.critical,
              }}
            >
              {hover.row.weight >= 0 ? "Positive" : "Negative"} influence · weight{" "}
              {hover.row.weight >= 0 ? "+" : ""}
              {hover.row.weight.toFixed(2)}
            </div>
            {hover.row.impact != null ? (
              <div style={{ fontSize: 11, color: C.muted }}>
                Current impact {hover.row.impact >= 0 ? "+" : ""}
                {hover.row.impact.toFixed(2)}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <ul style={srOnly}>
        {rows.map((row) => (
          <li key={`${row.driverId}:${row.resultId}`}>
            {row.driverLabel} influences {row.resultLabel} with weight {row.weight.toFixed(2)} (
            {row.weight >= 0 ? "positive" : "negative"})
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetricTable({
  groups,
  layout,
  onOpen,
}: {
  groups: Array<{ key: string; label: string | null; entries: MetricValue[] }>;
  layout: DashboardLayout;
  onOpen: (id: string) => void;
}) {
  const headerCell: CSSProperties = {
    padding: "6px 8px",
    fontWeight: 500,
    fontSize: 11,
    color: C.muted,
    textAlign: "left",
    whiteSpace: "nowrap",
  };
  const cell: CSSProperties = { padding: "8px", verticalAlign: "top" };
  const columns = 4 + (layout.showTargets ? 1 : 0) + (layout.showSource ? 1 : 0);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={headerCell}>Metric</th>
            <th style={headerCell}>Value</th>
            <th style={headerCell}>Status</th>
            {layout.showTargets ? <th style={headerCell}>Target</th> : null}
            {layout.showSource ? <th style={headerCell}>Source</th> : null}
            <th style={headerCell}>As of</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.key}>
              {group.label ? (
                <tr>
                  <td
                    colSpan={columns}
                    style={{
                      padding: "10px 8px 4px",
                      color: C.muted,
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {group.label}
                  </td>
                </tr>
              ) : null}
              {group.entries.map((entry) => (
                <tr
                  key={entry.definition.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(entry.definition.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpen(entry.definition.id);
                    }
                  }}
                  style={{ borderTop: `1px solid ${C.border}`, cursor: "pointer" }}
                >
                  <td style={cell}>{entry.definition.label}</td>
                  <td style={{ ...cell, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    {entry.displayValue ?? "No data"}
                  </td>
                  <td style={cell}>
                    {badge(
                      entry.state === "awaiting-data" ? "Awaiting data" : statusText(entry.status),
                      entry.state === "awaiting-data" ? "unknown" : entry.status,
                    )}
                  </td>
                  {layout.showTargets ? <td style={cell}>{targetText(entry)}</td> : null}
                  {layout.showSource ? <td style={{ ...cell, color: C.muted }}>{entry.definition.source}</td> : null}
                  <td style={{ ...cell, color: C.muted }}>{shortTime(entry.asOf)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BusinessBoardBody({
  payload,
  layout,
  onCustomize,
  onOpen,
}: {
  payload: CockpitPayload;
  layout: DashboardLayout;
  onCustomize: () => void;
  onOpen: (id: string) => void;
}) {
  const selected = resolveDashboardMetrics(payload, layout);
  if (selected.results.length === 0 && selected.drivers.length === 0) {
    return (
      <section aria-label="Business board" style={{ ...card, display: "grid", gap: 10 }}>
        <div style={{ color: C.muted, fontSize: 12 }}>
          No metrics selected for the board. Choose results or drivers from the profile.
        </div>
        <button type="button" style={button(true)} onClick={onCustomize}>
          Customize board
        </button>
      </section>
    );
  }

  const groups = layout.showGroups
    ? [
        { key: "results", label: "Results", entries: selected.results as MetricValue[] },
        { key: "drivers", label: "Drivers", entries: selected.drivers as MetricValue[] },
      ]
    : [{ key: "all", label: null, entries: selected.all }];
  const visibleGroups = groups.filter((group) => group.entries.length > 0);

  return (
    <section aria-label="Business board">
      <style>{BOARD_STYLES}</style>
      <div className="bc-board">
        {layout.viewMode === "table" ? (
          <MetricTable groups={visibleGroups} layout={layout} onOpen={onOpen} />
        ) : (
          visibleGroups.map((group) => (
            <div key={group.key} style={{ display: "grid", gap: 8 }}>
              {group.label ? <div className="bc-board-group-label">{group.label}</div> : null}
              <div
                className="bc-board-grid"
                style={{ "--bc-columns": layout.columns } as CSSProperties}
              >
                {group.entries.map((entry) => (
                  <BoardTile
                    key={entry.definition.id}
                    entry={entry}
                    display={layout.displays[entry.definition.id] ?? "number"}
                    showTargets={layout.showTargets}
                    showSource={layout.showSource}
                    onOpen={() => onOpen(entry.definition.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}

        {layout.showInfluence ? (
          <InfluenceGraph
            payload={payload}
            resultIds={selected.results.map((entry) => entry.definition.id)}
            onOpen={onOpen}
          />
        ) : null}
      </div>
    </section>
  );
}

function knownMetricIds(payload: CockpitPayload): Set<string> {
  return new Set([
    ...payload.results.map((entry) => entry.definition.id),
    ...payload.drivers.map((entry) => entry.definition.id),
  ]);
}

function pruneDashboardLayout(layout: DashboardLayout, payload: CockpitPayload): DashboardLayout {
  const known = knownMetricIds(payload);
  const metricIds = layout.metricIds.filter((id) => known.has(id));
  const displays = Object.fromEntries(
    Object.entries(layout.displays).filter(([id]) => metricIds.includes(id)),
  ) as Record<string, MetricDisplay>;
  return { ...layout, metricIds, displays };
}

function BoardCustomizeDrawer({
  open,
  companyId,
  payload,
  layout,
  onClose,
  onSaved,
}: {
  open: boolean;
  companyId: string;
  payload: CockpitPayload;
  layout: DashboardLayout;
  onClose: () => void;
  onSaved: () => void;
}) {
  const saveLayout = usePluginAction("save-dashboard-layout");
  const [draft, setDraft] = useState<DashboardLayout>(layout);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(pruneDashboardLayout(layout, payload));
    setError(null);
    setSaving(false);
  }, [open, layout]);

  if (!open) return null;

  const metrics = [
    ...payload.results.map((entry) => ({ id: entry.definition.id, label: entry.definition.label, role: "Result" })),
    ...payload.drivers.map((entry) => ({ id: entry.definition.id, label: entry.definition.label, role: "Driver" })),
  ];
  const selectedIds = new Set(draft.metricIds);
  const selectedMetrics = draft.metricIds
    .map((id) => metrics.find((metric) => metric.id === id))
    .filter((metric): metric is (typeof metrics)[number] => Boolean(metric));
  const availableMetrics = metrics.filter((metric) => !selectedIds.has(metric.id));
  const known = knownMetricIds(payload);
  const staleCount = layout.metricIds.filter((id) => !known.has(id)).length;

  function toggle(id: string) {
    if (selectedIds.has(id)) {
      setDraft((prev) => ({ ...prev, metricIds: prev.metricIds.filter((metricId) => metricId !== id) }));
      setError(null);
      return;
    }
    if (draft.metricIds.length >= MAX_DASHBOARD_METRICS) {
      setError(`The board supports at most ${MAX_DASHBOARD_METRICS} metrics.`);
      return;
    }
    setDraft((prev) => ({ ...prev, metricIds: [...prev.metricIds, id] }));
    setError(null);
  }

  function move(id: string, delta: number) {
    setDraft((prev) => {
      const index = prev.metricIds.indexOf(id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= prev.metricIds.length) return prev;
      const metricIds = [...prev.metricIds];
      [metricIds[index], metricIds[target]] = [metricIds[target], metricIds[index]];
      return { ...prev, metricIds };
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const layout: DashboardLayout = {
        ...draft,
        displays: Object.fromEntries(
          Object.entries(draft.displays).filter(([id]) => draft.metricIds.includes(id)),
        ) as Record<string, MetricDisplay>,
      };
      await saveLayout({ companyId, layout });
      onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Customize business board"
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.4)", display: "flex", justifyContent: "flex-end" }}
      onClick={onClose}
    >
      <div
        style={{ width: "min(620px, 100%)", height: "100%", overflowY: "auto", background: C.card, borderLeft: `1px solid ${C.border}`, padding: 18, display: "grid", gap: 14, alignContent: "start" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CockpitIcon size={16} />
            <strong style={{ fontSize: 14 }}>Customize business board</strong>
          </div>
          <button type="button" style={button()} onClick={onClose}>
            Close
          </button>
        </div>
        <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.6 }}>
          Pick the results and drivers shown on the Business Board page. The board is company-scoped; changing it here does not edit the profile.
        </div>
        {staleCount > 0 ? (
          <div style={{ color: C.warn, fontSize: 11 }}>
            {staleCount} saved metric{staleCount === 1 ? "" : "s"} no longer exist in the profile and were removed.
          </div>
        ) : null}

        <section style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
            <strong style={{ fontSize: 13 }}>Selected ({draft.metricIds.length})</strong>
            <button
              type="button"
              style={button()}
              onClick={() =>
                setDraft((prev) => {
                  const reset = defaultDashboardLayout(payload.profile);
                  return {
                    ...reset,
                    displays: prev.displays,
                    columns: prev.columns,
                    viewMode: prev.viewMode,
                    showGroups: prev.showGroups,
                    showTargets: prev.showTargets,
                    showSource: prev.showSource,
                    showInfluence: prev.showInfluence,
                  };
                })
              }
            >
              Reset to results
            </button>
          </div>
          {selectedMetrics.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 12, border: `1px dashed ${C.border}`, borderRadius: 8, padding: 12 }}>
              No metrics selected. The board will be hidden on the Business Board page.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {selectedMetrics.map((metric, index) => (
                <div
                  key={metric.id}
                  style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 8px" }}
                >
                  <span style={{ ...mono, color: C.muted, width: 18, textAlign: "right" }}>{index + 1}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                    {metric.label}
                    <span style={{ color: C.muted, fontSize: 11 }}> · {metric.role}</span>
                  </span>
                  <select
                    value={draft.displays[metric.id] ?? "number"}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        displays: { ...prev.displays, [metric.id]: event.target.value as MetricDisplay },
                      }))
                    }
                    aria-label={`Display ${metric.label}`}
                    style={{ ...button(), minHeight: 28, padding: "4px 6px" }}
                  >
                    <option value="number">Number</option>
                    <option value="bar">Bar</option>
                    <option value="bullet">Bullet</option>
                    <option value="gauge">Gauge</option>
                  </select>
                  <button type="button" style={button(false, index === 0)} onClick={() => move(metric.id, -1)} aria-label={`Move ${metric.label} up`}>
                    Up
                  </button>
                  <button
                    type="button"
                    style={button(false, index === selectedMetrics.length - 1)}
                    onClick={() => move(metric.id, 1)}
                    aria-label={`Move ${metric.label} down`}
                  >
                    Down
                  </button>
                  <button type="button" style={button()} onClick={() => toggle(metric.id)} aria-label={`Remove ${metric.label}`}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={{ display: "grid", gap: 8 }}>
          <strong style={{ fontSize: 13 }}>Available</strong>
          {availableMetrics.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 12 }}>Every result and driver is already selected.</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {availableMetrics.map((metric) => (
                <div
                  key={metric.id}
                  style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 8px" }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                    {metric.label}
                    <span style={{ color: C.muted, fontSize: 11 }}> · {metric.role}</span>
                  </span>
                  <button type="button" style={button()} onClick={() => toggle(metric.id)}>
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <label style={{ fontSize: 12, color: C.muted }} htmlFor="bc-board-view">View</label>
            <select
              id="bc-board-view"
              value={draft.viewMode}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, viewMode: event.target.value === "table" ? "table" : "cards" }))
              }
              style={{ ...button(), cursor: "pointer", justifySelf: "start", minWidth: 120 }}
            >
              <option value="cards">Cards</option>
              <option value="table">Table</option>
            </select>
          </div>
          {draft.viewMode === "cards" ? (
            <div style={{ display: "grid", gap: 4 }}>
              <label style={{ fontSize: 12, color: C.muted }} htmlFor="bc-board-columns">Columns</label>
              <select
                id="bc-board-columns"
                value={draft.columns}
                onChange={(event) => setDraft((prev) => ({ ...prev, columns: Number(event.target.value) as DashboardColumnCount }))}
                style={{ ...button(), cursor: "pointer", justifySelf: "start", minWidth: 100 }}
              >
                {[2, 3, 4, 6].map((columns) => (
                  <option key={columns} value={columns}>{columns}</option>
                ))}
              </select>
            </div>
          ) : null}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={draft.showGroups}
              onChange={(event) => setDraft((prev) => ({ ...prev, showGroups: event.target.checked }))}
            />
            Group results and drivers
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={draft.showTargets}
              onChange={(event) => setDraft((prev) => ({ ...prev, showTargets: event.target.checked }))}
            />
            Show targets and gaps
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={draft.showSource}
              onChange={(event) => setDraft((prev) => ({ ...prev, showSource: event.target.checked }))}
            />
            Show metric source and as-of
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={draft.showInfluence}
              onChange={(event) => setDraft((prev) => ({ ...prev, showInfluence: event.target.checked }))}
            />
            Show driver influence
          </label>
        </section>

        {error ? <div style={{ color: C.critical, fontSize: 12 }}>{error}</div> : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={button()} onClick={onClose}>
            Cancel
          </button>
          <button type="button" style={button(true, saving)} onClick={() => void save()} disabled={saving}>
            {saving ? "Saving..." : "Save board"}
          </button>
        </div>
      </div>
    </div>
  );
}

