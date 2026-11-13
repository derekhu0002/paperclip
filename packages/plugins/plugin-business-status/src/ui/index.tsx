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

function leverAction(driver: DriverValue): string {
  const current = driver.displayValue ?? "—";
  const target = formatMetricValue(driver.definition.target, driver.definition.unit) ?? "—";
  const verb = driver.definition.direction === "higher-is-better" ? "Improve" : "Reduce";
  return `${verb} ${driver.definition.label} (${current} → ${target})`;
}

function ResultCard({
  result,
  selected,
  onSelect,
}: {
  result: MetricValue;
  selected: boolean;
  onSelect: () => void;
}) {
  const awaiting = result.state === "awaiting-data";
  const color = statusColor(result.status);
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        ...card,
        textAlign: "left",
        cursor: "pointer",
        display: "grid",
        gap: 8,
        borderColor: selected ? C.info : C.border,
        background: selected ? C.accent : C.card,
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
    </button>
  );
}

function DriverRow({ driver, selectedResultId, maxImpact }: { driver: DriverValue; selectedResultId: string; maxImpact: number }) {
  const impact = impactFor(driver, selectedResultId);
  const width = maxImpact > 0 ? Math.max(2, (impact / maxImpact) * 100) : 0;
  const awaiting = driver.state === "awaiting-data";
  return (
    <div style={{ display: "grid", gap: 5, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: C.fg }}>{driver.definition.label}</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", color: awaiting ? C.muted : C.fg }}>
            {driver.displayValue ?? "—"}
          </span>
          {badge(awaiting ? "Awaiting data" : statusText(driver.status), awaiting ? "unknown" : driver.status)}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: C.muted, fontSize: 11 }}>
        <span>Target {formatMetricValue(driver.definition.target, driver.definition.unit) ?? "—"}</span>
        <span>Impact {impact > 0 ? impact.toFixed(2) : "—"}</span>
      </div>
      <div style={{ height: 4, background: C.border, borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${width}%`, height: "100%", background: statusColor(driver.status) }} />
      </div>
    </div>
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
          Edit the JSON profile for this company. The profile defines key results, process drivers, causal weights, targets and metric sources. It is stored per company; the Agent can also write it through{" "}
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
          Metric sources: <code style={{ color: C.info }}>paperclip</code> (computed by the host), <code style={{ color: C.info }}>snapshot</code> (ingested through the metrics API), <code style={{ color: C.info }}>static</code> (fixed value). See AGENT-API.md for the full schema.
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
  const initialResultId = useMemo(() => {
    const withDrivers = payload.results.find((entry) =>
      payload.drivers.some((driver) => driver.impacts.some((impact) => impact.resultId === entry.definition.id)),
    );
    const current = payload.results.find((entry) => entry.state === "current");
    return (withDrivers ?? current ?? payload.results[0])?.definition.id ?? "";
  }, [payload]);
  const [selectedResultId, setSelectedResultId] = useState(initialResultId);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!payload.results.some((entry) => entry.definition.id === selectedResultId)) {
      setSelectedResultId(initialResultId);
    }
  }, [initialResultId, payload.results, selectedResultId]);
  const result = payload.results.find((entry) => entry.definition.id === selectedResultId) ?? payload.results[0] ?? null;
  const selectedId = result?.definition.id ?? "";

  const linkedDrivers = useMemo(() => {
    return payload.drivers
      .filter((driver) => driver.impacts.some((impact) => impact.resultId === selectedId))
      .sort((a, b) => impactFor(b, selectedId) - impactFor(a, selectedId));
  }, [payload.drivers, selectedId]);

  const maxImpact = linkedDrivers.reduce((max, driver) => Math.max(max, impactFor(driver, selectedId)), 0);
  const levers = payload.levers.filter((lever) => lever.results.includes(selectedId)).slice(0, 4);

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
        <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
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
          {copied ? <span style={{ color: C.muted, fontSize: 11 }}>{copied}</span> : null}
        </div>
      </header>

      <section style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        {payload.results.map((entry) => (
          <ResultCard
            key={entry.definition.id}
            result={entry}
            selected={entry.definition.id === selectedId}
            onSelect={() => setSelectedResultId(entry.definition.id)}
          />
        ))}
      </section>

      {result ? (
        <section style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(0, 1.5fr) minmax(280px, 1fr)" }}>
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <div>
                <strong style={{ fontSize: 14 }}>{result.definition.label} · Process drivers</strong>
                <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
                  Current {result.displayValue ?? "—"} · Target {targetText(result)} · {gapText(result)}
                </div>
              </div>
              {badge(result.state === "awaiting-data" ? "Awaiting data" : statusText(result.status), result.state === "awaiting-data" ? "unknown" : result.status)}
            </div>
            {linkedDrivers.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 12 }}>No process drivers are linked to this result.</div>
            ) : (
              linkedDrivers.map((driver) => (
                <DriverRow key={driver.definition.id} driver={driver} selectedResultId={selectedId} maxImpact={maxImpact} />
              ))
            )}
          </div>

          <div style={card}>
            <strong style={{ fontSize: 14 }}>Levers</strong>
            <p style={{ color: C.muted, fontSize: 11, margin: "4px 0 10px", lineHeight: 1.5 }}>
              Ranked by gap × causal weight. Move the top lever first.
            </p>
            {levers.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.6 }}>
                All configured drivers are on target, so they do not explain the gap on "{result.definition.label}". Add a driver or review the causal model.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {levers.map((lever, index) => {
                  const driver = payload.drivers.find((entry) => entry.definition.id === lever.driverId);
                  return (
                    <div key={lever.driverId} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 9 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>
                          {index + 1}. {lever.label}
                        </span>
                        {badge(statusText(lever.status), lever.status)}
                      </div>
                      <div style={{ color: C.muted, fontSize: 11, marginTop: 3 }}>{driver ? leverAction(driver) : "—"}</div>
                      <div style={{ color: C.info, fontSize: 11, marginTop: 2 }}>Impact score {lever.impact.toFixed(2)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      ) : null}

      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <strong style={{ fontSize: 14 }}>Process metrics</strong>
          <span style={{ color: C.muted, fontSize: 11 }}>Only drivers in the profile are shown. Missing values stay "awaiting data"; they are never filled with 0.</span>
        </div>
        <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.accent, color: C.muted, textAlign: "left" }}>
                {["Driver", "Current", "Target", "Direction", "Status", "Affects", "Formula / Source"].map((title) => (
                  <th key={title} style={{ padding: "8px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>{title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payload.drivers.map((driver) => {
                const awaiting = driver.state === "awaiting-data";
                return (
                  <tr key={driver.definition.id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "8px 10px", color: C.fg, whiteSpace: "nowrap" }}>{driver.definition.label}</td>
                    <td style={{ padding: "8px 10px", fontVariantNumeric: "tabular-nums", color: awaiting ? C.muted : C.fg }}>
                      {driver.displayValue ?? "—"}
                    </td>
                    <td style={{ padding: "8px 10px", color: C.muted }}>
                      {formatMetricValue(driver.definition.target, driver.definition.unit) ?? "—"}
                    </td>
                    <td style={{ padding: "8px 10px", color: C.muted, whiteSpace: "nowrap" }}>
                      {directionLabel(driver.definition.direction)}
                    </td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      {badge(awaiting ? "Awaiting data" : statusText(driver.status), awaiting ? "unknown" : driver.status)}
                    </td>
                    <td style={{ padding: "8px 10px", color: C.muted, ...mono }}>{driver.affects.join(", ") || "—"}</td>
                    <td style={{ padding: "8px 10px", color: C.muted, minWidth: 220 }}>
                      {driver.provenance.formula ?? driver.definition.formula ?? "—"}
                      <div style={{ ...mono, color: C.muted, marginTop: 2 }}>
                        {driver.provenance.source ?? "—"} · {shortTime(driver.asOf)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section style={card}>
        <details>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Data sources and configuration</summary>
          <div style={{ display: "grid", gap: 6, marginTop: 10, color: C.muted, fontSize: 12, lineHeight: 1.7 }}>
            <span>Metric ingest: <code style={{ color: C.info }}>POST {payload.snapshot.ingestRoute}</code> (companyId + values); undeclared ids or missing asOf are rejected.</span>
            <span>Profile: <code style={{ color: C.info }}>POST {payload.snapshot.profileRoute}</code> (companyId + profile JSON). Stored per company; you or an Agent can design it.</span>
            <span>Snapshot updated: {shortTime(payload.snapshot.updatedAt)} · values: {payload.snapshot.valueCount}.</span>
            <span>This page is read-only; it never writes issues, goals, agents or project graphs.</span>
          </div>
        </details>
      </section>
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


