# Business Cockpit

`paperclip.business-status` is a company-scoped business operating cockpit for Paperclip. It puts key results on top and the process drivers that move them below, then ranks the levers to move first.

This is a framework, not a fixed KPI wall. It ships one editable profile model per company. A human can edit the JSON profile in the UI; an Agent can design or update it through the API. No business presets are hardcoded.

## Model

A profile has three parts:

- `results`: the outcomes the business is accountable for (3–5 recommended).
- `drivers`: the process metrics that influence the results. `affects` is optional and lists the downstream results used by the lever ranking.
- `links`: causal edges from a driver to a result with a weight from -1 to 1.

Any metric can also declare `inputs`: a list of metric ids (or `{ id, weight, role, note }` objects) that explain how it is composed. This turns results and drivers into one metric DAG: a driver can be an input to another driver, and a result can be an input to another metric. Each metric can also declare a `description` explaining what it means and why it matters.

For measured metrics, `inputs` is explanatory: `weight` is between -1 and 1 and expresses influence. For `source: "computed"`, the plugin evaluates the inputs recursively. Supported aggregations are `sum`, `weighted-sum`, `average`, `ratio`, `min` and `max`; `ratio` requires exactly one `role: "numerator"` and one `role: "denominator"` input.

The plugin validates every input reference, rejects self-references and cycles, and treats links/`affects` as dependency edges when checking the graph. The validation order is deterministic and errors include the metric/path and a fix hint. A `computed` metric must have at least one input; a leaf cannot be computed. If any input is missing, the computed metric stays `awaiting-data`; it is never filled with 0.

The UI ranks levers by `driver gap × abs(weight)`. A driver with no gap does not appear as an actionable lever; if no configured driver explains a result gap, the UI says so instead of inventing a cause.

Metric sources:

- `paperclip`: computed by the host from issues, goals and agents; not ingestible.
- `snapshot`: written by the company Knowledge Manager from project-Lead evidence; the only ingestible source.
- `static`: fixed value in the profile; not ingestible.
- `computed`: derived from its `inputs` by the plugin; not ingestible.

`POST /metrics` rejects every non-`snapshot` id with a `metric-not-ingestible` reason and a message that names the source and explains what to do instead.

## Governance

Governance is company-scoped **Plugin Settings**, controlled by the board/operator, not by the profile:

- `profileWriterAgentId`: the Knowledge Manager Agent id allowed to write the profile.
- `snapshotWriterAgentIds`: the Knowledge Manager Agent id(s) allowed to ingest snapshot values.
- `allowBoardBackfill`: emergency board override; keep `false` for the KM-only writer rule.

Bindings use `agent.id` (UUID), never the Agent name. A missing configuration returns `governance-not-configured`; a non-writer returns `writer-not-authorized`. Project Leads provide evidence and validate numbers, but the Knowledge Manager is the single cockpit writer.

## UI

- Home: the configurable business board (results and drivers).
- Click a board tile or table row: open its detail page with the metric's meaning, definition, calculation, input relationship (weights and notes), provenance and input cards.
- Click an input card: drill into that metric using the same layout.
- Leaf metrics show where the measurement comes from (`source`, `sourceRef`, `commit`, `digest`, `asOf`, `note`) and stop drilling.
- Sidebar entry: **Business Cockpit**.
- Page: `/:companyPrefix/business-status`.
- **Configure** opens a JSON editor for the active profile.
- **Customize board** opens the board layout drawer.
- Missing values show **Awaiting data**; they are never filled with `0`.

## Cockpit home board

The cockpit home is the business board; the metric detail drill-down is unchanged.
The plugin does **not** declare a dashboard widget and does not add anything to
the host Dashboard.

- The board reads the same profile and the same computed/snapshot values as the
  cockpit; the profile remains the single metric definition.
- Each selected metric can render as **Number**, **Bar**, **Bullet**, or
  **Gauge** in the **Cards** view; the **Table** view shows a dense
  metric/value/status/target/source comparison.
- **Show driver influence** draws a directed driver-to-result graph. Edge
  color shows positive/negative influence, edge width shows the absolute
  weight, and hovering an edge shows the driver, result, weight, direction and
  current impact. Result nodes open the metric detail.
- **Customize board** opens a board-only drawer: add or remove any result/driver,
  reorder the selected list, choose each metric's display, choose 2/3/4/6
  columns, and toggle groups, targets/gaps, source/as-of, and driver influence.
- The layout is company-scoped plugin state; it is a board preference, not part
  of the cockpit profile, so it does not require the Knowledge Manager writer
  grant.
- If a selected metric disappears from the profile, the board ignores it and the
  drawer reports how many saved metrics were removed.
- Leave the selection empty to show a "no metrics selected" state; Customize
  can restore it.

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
