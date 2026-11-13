# Business Cockpit

`paperclip.business-status` is a company-scoped business operating cockpit for Paperclip. It puts key results on top and the process drivers that move them below, then ranks the levers to move first.

This is a framework, not a fixed KPI wall. It ships one editable profile model per company. A human can edit the JSON profile in the UI; an Agent can design or update it through the API. No business presets are hardcoded.

## Model

A profile has three parts:

- `results`: the outcomes the business is accountable for (3–5 recommended).
- `drivers`: the process metrics that influence the results. `affects` is optional and lists the downstream results used by the lever ranking.
- `links`: causal edges from a driver to a result with a weight from -1 to 1.

Any metric can also declare `inputs`: a list of metric ids (or `{ id, weight, note }` objects) that explain how it is composed. This turns results and drivers into one metric DAG: a driver can be an input to another driver, and a result can be an input to another metric. `weight` is between -1 and 1; it expresses how strongly the input moves the metric, and a negative weight means the opposite direction. Each metric can also declare a `description` explaining what it means and why it matters.

The plugin validates every input reference, rejects self-references and cycles, and treats links/`affects` as dependency edges when checking the graph. The validation order is deterministic: unknown inputs, self-references and cycles are rejected before the profile is saved.

The UI ranks levers by `driver gap × abs(weight)`. A driver with no gap does not appear as an actionable lever; if no configured driver explains a result gap, the UI says so instead of inventing a cause.

Metric sources:

- `paperclip`: computed by the host from issues, goals and agents.
- `snapshot`: ingested by a project/Agent with provenance.
- `static`: fixed value, only when intentional.

`inputs` is explanatory in this version: the plugin does not recompute a parent value from its inputs. A leaf metric is a metric with no `inputs`; its value and provenance come from `paperclip`, `snapshot` or `static`.

## UI

- Home: only the company's final results.
- Click a result: open its detail page with the metric's meaning, definition, calculation, input relationship (weights and notes), provenance and input cards.
- Click an input card: drill into that metric using the same layout.
- Leaf metrics show where the measurement comes from (`source`, `sourceRef`, `commit`, `digest`, `asOf`, `note`) and stop drilling.
- Sidebar entry: **Business Cockpit**.
- Page: `/:companyPrefix/business-status`.
- Dashboard widget: top results for the company.
- **Configure** opens a JSON editor for the active profile.
- Missing values show **Awaiting data**; they are never filled with `0`.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/plugins/paperclip.business-status/api/overview?companyId=…` | Read the profile, computed values and levers. |
| POST | `/api/plugins/paperclip.business-status/api/profile` | Create or replace the cockpit profile. |
| POST | `/api/plugins/paperclip.business-status/api/metrics` | Upsert snapshot values. |

The full profile schema, host-computed metric keys and Agent workflow are in the bundled skill `paperclipai/bundled/paperclip-operations/business-cockpit` (Skills → Catalog). The skill ships in the image but is not installed or enabled by default.

## Build and verify

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Install

Local-path installs need the host SDK:

```bash
mkdir -p node_modules/@paperclipai
ln -s /app/packages/plugins/sdk node_modules/@paperclipai/plugin-sdk
```

Then, as the host operator:

```bash
paperclipai plugin install /abs/path/to/business-status
paperclipai plugin inspect paperclip.business-status
```

The plugin is not bound to a company. Every company can have its own profile; state is company-scoped.
