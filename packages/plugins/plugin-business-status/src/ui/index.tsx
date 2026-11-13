import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  copyTextToClipboard,
  useHostNavigation,
  usePluginAction,
  usePluginData,
  type PluginPageProps,
  type PluginSidebarProps,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import {
  PLUGIN_ID,
  STATUS_ROUTE_PATH,
  directionLabel,
  formatMetricValue,
  type BusinessProfile,
  type CockpitPayload,
  type DriverValue,
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
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 20, fontWeight: 650, fontVariantNumeric: "tabular-nums", color: awaiting ? C.muted : C.fg }}>
          {metric.displayValue ?? "—"}
        </span>
        <span style={{ color: C.muted, fontSize: 11 }}>Target {targetText(metric)}</span>
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
          Weights express how strongly each input moves this metric. A negative weight means the input moves it in the opposite direction. The displayed value is measured from the declared source; this version does not recompute it from inputs.
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
                    <span style={{ color: C.muted, fontSize: 11 }}> · {input.entry.role === "result" ? "result" : "driver"}</span>
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
          Metric sources: <code style={{ color: C.info }}>paperclip</code> (computed by the host), <code style={{ color: C.info }}>snapshot</code> (ingested through the metrics API), <code style={{ color: C.info }}>static</code> (fixed value). Use <code style={{ color: C.info }}>inputs</code> to nest one metric under another. See the bundled business-cockpit skill for the full schema.
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
        <>
          <div style={{ color: C.muted, fontSize: 12 }}>
            Select a result to inspect its definition, calculation, inputs and provenance.
          </div>
          <section style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
            {payload.results.map((entry) => (
              <ResultCard
                key={entry.definition.id}
                result={entry}
                onOpen={() => setPath([entry.definition.id])}
              />
            ))}
          </section>
        </>
      )}
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

export function BusinessStatusWidget({ context }: PluginWidgetProps) {
  const companyId = context.companyId ?? "";
  const { data, loading } = usePluginData<CockpitPayload>("business-status", { companyId });
  if (!companyId || loading || !data) {
    return <section style={{ ...card, color: C.muted, fontSize: 12 }}>Business Cockpit: loading…</section>;
  }
  if (!data.configured) {
    return (
      <section style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <CockpitIcon size={14} />
          <strong style={{ fontSize: 13 }}>Business Cockpit</strong>
        </div>
        <div style={{ color: C.muted, fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
          Not configured for this company. Open the cockpit to define results and drivers.
        </div>
      </section>
    );
  }
  const results = data.results.slice(0, 3);
  return (
    <section style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <CockpitIcon size={14} />
          <strong style={{ fontSize: 13 }}>Business Cockpit</strong>
        </span>
        {badge(`as-of ${shortTime(data.asOf)}`, "unknown")}
      </div>
      <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{data.business?.name ?? "Cockpit"}</div>
      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
        {results.map((result) => (
          <div key={result.definition.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
            <span style={{ color: C.muted }}>{result.definition.label}</span>
            <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>{result.displayValue ?? "—"}</strong>
              {badge(result.state === "awaiting-data" ? "Awaiting data" : statusText(result.status), result.state === "awaiting-data" ? "unknown" : result.status)}
            </span>
          </div>
        ))}
      </div>
      <div style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>
        {data.results.length} results · {data.drivers.length} drivers · {data.levers.length} levers
      </div>
    </section>
  );
}


