---
name: business-cockpit
description: Maintain a company's Paperclip Business Cockpit (paperclip.business-status): design key results and the process drivers that move them, then ingest evidence-backed snapshot metrics through the plugin API.
key: paperclipai/bundled/paperclip-operations/business-cockpit
recommendedForRoles:
  - manager
  - general
tags:
  - paperclip
  - business-status
  - cockpit
  - metrics
  - knowledge-management
defaultInstall: false
---

# Business Cockpit

Use this skill when you are the knowledge-management agent for a Paperclip company and need to maintain its Business Cockpit plugin.

## What you own

- The cockpit profile: key results, process drivers, causal links, targets and thresholds.
- The snapshot values for metrics whose profile entry uses `source: "snapshot"`.
- The explanation of what is on track, what is missing, and which lever to move.

You do not own the plugin code. Installing, upgrading or changing the plugin is the host operator's job. Do not edit project graphs, schemas or host code from this plugin.

## Scope

- The cockpit is **company-scoped**. One profile and one snapshot per `companyId`.
- A new company starts unconfigured. Design its profile before writing values.
- Multiple projects in the same company share one cockpit. If each project needs its own card, use project-prefixed metric ids in the same profile, for example `foo.detection-coverage` and `bar.detection-coverage`.

## API access

Ask the host operator for:

- the public Paperclip base URL (for example `https://paperclip.example.com`)
- a token that can call the plugin routes: a board token or an Agent API key

If `PAPERCLIP_API_URL` points to a local sandbox bridge, `/api/plugins/*` is not forwarded through it. Do not use `PAPERCLIP_API_URL` for these routes. Use the public host base with the token from the operator, or ask the operator to allow the plugin routes on the bridge.

Never print the token or put it in a metric note.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/plugins/paperclip.business-status/api/overview?companyId=<id>` | Read the active profile, values, statuses and lever ranking. |
| POST | `/api/plugins/paperclip.business-status/api/profile` | Create or replace the company's cockpit profile. |
| POST | `/api/plugins/paperclip.business-status/api/metrics` | Upsert snapshot values. |

All routes require `Authorization: Bearer <token>`. Send the `companyId` you are authorized for; an Agent API key is scoped to its company. Do not query another company's cockpit.

## Governance

The board configures company-scoped **Plugin Settings** with `agent.id` values, never Agent names:

- `profileWriterAgentId`: the Knowledge Manager Agent allowed to write the profile.
- `snapshotWriterAgentIds`: the Knowledge Manager Agent(s) allowed to ingest snapshot values.
- `allowBoardBackfill`: emergency board override; keep `false`.

The Knowledge Manager is the single writer of profile and snapshot values. Project Leads provide and validate evidence, but they do not write the company cockpit. A missing configuration returns `governance-not-configured` (HTTP 409); a non-writer returns `writer-not-authorized` (HTTP 403). Do not retry around either error.

## Profile schema

The object below is the value of `profile` in `POST /api/plugins/paperclip.business-status/api/profile`; the request body is `{ "companyId": "<company-id>", "profile": { ... } }`.

```json
{
  "name": "Example Cockpit",
  "description": "One sentence about the business.",
  "results": [
    {
      "id": "delivery-throughput",
      "label": "Delivery Throughput (30d)",
      "description": "How much finished work the company delivered in the last 30 days.",
      "unit": "count",
      "direction": "higher-is-better",
      "target": 10,
      "warn": 5,
      "critical": 2,
      "source": "paperclip",
      "sourceRef": "delivery-throughput",
      "formula": "Issues completed in the last 30 days.",
      "inputs": [
        { "id": "wip", "weight": 0.3, "note": "More WIP slows the flow." },
        { "id": "flow-efficiency", "weight": 0.2 }
      ]
    }
  ],
  "drivers": [
    {
      "id": "wip",
      "label": "Work in Progress",
      "description": "How many issues are open and actively being worked on.",
      "unit": "count",
      "direction": "lower-is-better",
      "target": 10,
      "warn": 20,
      "critical": 30,
      "source": "paperclip",
      "sourceRef": "wip",
      "formula": "Issues currently in progress.",
      "affects": ["delivery-throughput"]
    },
    {
      "id": "flow-efficiency",
      "label": "Flow Efficiency",
      "description": "How much of the cycle time is active work rather than waiting.",
      "unit": "ratio",
      "direction": "higher-is-better",
      "target": 0.6,
      "warn": 0.4,
      "critical": 0.2,
      "source": "snapshot",
      "sourceRef": "flow-efficiency",
      "formula": "Active time / total cycle time.",
      "inputs": [{ "id": "wip", "weight": -0.5, "note": "High WIP increases waiting time." }],
      "affects": ["delivery-throughput"]
    }
  ],
  "links": [
    { "from": "wip", "to": "delivery-throughput", "weight": 0.3 },
    { "from": "flow-efficiency", "to": "delivery-throughput", "weight": 0.2 }
  ]
}
```

### Metric fields

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Lowercase slug, unique across results and drivers. |
| `label` | yes | Human-readable name. |
| `description` | no | What the metric means and why it matters; shown on the metric detail page. |
| `unit` | yes | `ratio`, `count`, `days`, `currency` or `score`. |
| `direction` | yes | `higher-is-better` or `lower-is-better`. |
| `target` | yes | Numeric target. |
| `warn` / `critical` | no | Thresholds used for the status badge. |
| `source` | yes | `paperclip`, `snapshot`, `static` or `computed`. |
| `sourceRef` | for `paperclip` | Host-computed metric key. |
| `formula` | no | Plain-language formula shown in the UI. |
| `value` | for `static` | Fixed numeric value. |
| `aggregation` | for `computed` | `sum`, `weighted-sum`, `average`, `ratio`, `min` or `max`. |
| `inputs` | no | Metric ids that explain how this metric is composed. Each entry is `{ "id", "weight"?, "role"?, "note"? }`; a bare id string is also accepted. |

`inputs` turns results and drivers into one metric DAG. A driver can be an input to another driver, and a result can be an input to another metric. A metric with no `inputs` is a leaf; a leaf must be `paperclip`, `snapshot` or `static`, never `computed`.

For measured metrics (`paperclip`, `snapshot`, `static`), `inputs` is explanatory: the plugin shows the hierarchy, weight and provenance but does not recompute the value. For `computed`, the plugin evaluates inputs recursively; a missing input keeps the parent `awaiting-data`.

`weight` has two meanings:

- measured metrics: influence weight between `-1` and `1`; negative means opposite direction.
- `computed` + `weighted-sum`: formula coefficient (any finite number).

`ratio` requires exactly one input with `"role": "numerator"` and one with `"role": "denominator"`; weights are not used.

Only `source: "snapshot"` metrics can be ingested through `POST /metrics`. A `computed`, `paperclip` or `static` id is rejected with `reason: "metric-not-ingestible"` and a message naming the source and the correct action.

The plugin validates the full dependency graph deterministically: explicit `inputs`, plus links and `affects` (a link is treated as the result depending on the driver). Unknown inputs, self-references and cycles are rejected before the profile is saved; each error includes the metric path and a fix hint.

A driver's `affects` is optional. When present, it lists downstream result ids used by the lever ranking.

A link connects a driver id (`from`) to a result id (`to`) with a weight between `-1` and `1`. The cockpit ranks levers by driver gap multiplied by the absolute weight.

### Computed example

```json
{
  "id": "weighted-coverage",
  "label": "Weighted Coverage",
  "unit": "ratio",
  "direction": "higher-is-better",
  "target": 0.8,
  "source": "computed",
  "aggregation": "weighted-sum",
  "inputs": [
    { "id": "telemetry-source-coverage", "weight": 0.4 },
    { "id": "validated-coverage-rate", "weight": 0.6 }
  ]
}
```

The Agent may ingest `telemetry-source-coverage` and `validated-coverage-rate` if they are `snapshot`, but must not ingest `weighted-coverage`; the plugin computes it.

## Host-computed metrics (`source: "paperclip"`)

Use one of these `sourceRef` values. The host computes them from Paperclip issues, goals and agents; no ingestion is required.

| sourceRef | Unit | Formula |
| --- | --- | --- |
| `goal-progress` | ratio | Done issues under active goals / all issues under active goals. |
| `delivery-throughput` | count | Issues completed in the last 30 days. |
| `cycle-time` | days | Median `completedAt - startedAt` for issues completed in the last 30 days. |
| `budget-burn` | ratio | Agent monthly spend / agent monthly budget. |
| `risk-blocked` | count | Issues currently blocked. |
| `wip` | count | Issues currently in progress. |
| `queue-age` | days | Median age of todo issues. |
| `blocked-age` | count | Blocked issues blocked for more than 3 days. |
| `review-queue` | count | Issues currently in review. |
| `agent-availability` | ratio | Idle or running agents / non-terminated agents. |
| `cost-per-delivery` | currency | Agent monthly spend in USD / issues completed in the last 30 days. |

## Snapshot metrics (`source: "snapshot"`)

Use `sourceRef` as the stable key. If `sourceRef` is omitted, the metric `id` is the key.

```http
POST /api/plugins/paperclip.business-status/api/metrics
Content-Type: application/json
Authorization: Bearer <token>

{
  "companyId": "<company-id>",
  "values": [
    {
      "id": "detection-coverage-rate",
      "value": 0.9677,
      "asOf": "2026-11-13T05:43:06Z",
      "source": "qwenpaw-blue",
      "commit": "e0387e6",
      "digest": "sha256:...",
      "note": "30/31 techniques have a detection rule"
    }
  ]
}
```

Rules:

- `id` must be a `snapshot` sourceRef declared in the active profile.
- `value` must be a finite number and `asOf` must be ISO-8601.
- Unknown ids, missing `asOf`, or non-numeric values are returned in `rejected`.
- Missing values stay `awaiting-data`; never fill them with `0`.
- The write is an upsert; the last write for an id wins. Activity log keeps the history.
- The current plugin does not compute stale/TTL automatically. It shows `asOf`; refresh on your own cadence.

## Workflow

1. `GET overview` and read the current profile, values, levers and `awaiting-data` items.
2. Design or update the profile:
   - 3 to 5 key results (business outcomes, not technical implementation details).
   - 5 to 8 drivers that can move those results.
   - A target, warning and critical threshold for each.
   - Causal links with weights.
   - `inputs` on any metric that is composed from other metrics; use it to expose the hierarchy down to leaf measurements. `inputs` may reference results or drivers and must stay acyclic.
   - `paperclip` source where the host already computes it; `snapshot` for project-specific evidence.
3. `POST profile` with the full profile. It replaces the company's previous profile.
4. Collect evidence from the project Lead (graph, issues, runs or documents). The Knowledge Manager is the single writer; include `source`, `commit`, `digest`, `asOf` and a note with numerator/denominator.
5. `POST metrics` with only the values you can prove, and only as the configured Knowledge Manager writer.
6. `GET overview` again. Report before/after values, levers, and every metric that is still `awaiting-data` and why.
7. Refresh periodically or when the project graph/schema changes. Ask project Leads for missing exports through issues.

## Guardrails

- Only the configured Knowledge Manager may write profile or snapshot. If you get `writer-not-authorized` or `governance-not-configured`, stop and ask the board/KM; do not retry or bypass.
- Only ingest `source: "snapshot"` ids. If `POST /metrics` returns `metric-not-ingestible`, do not retry the same id; the value is host-computed, fixed or derived from inputs.
- On profile validation errors, read the reported path and hint, fix the profile, and resubmit. Do not bypass a cycle, unknown input or invalid aggregation.
- Do not fabricate values. If a result cannot be computed, leave it `awaiting-data` and name the missing source.
- Do not write issues, goals, agents or project graphs from this skill.
- Do not install, upgrade or configure the plugin.
- Do not put secrets in notes, comments or descriptions.
- Keep every metric company-scoped; never read or write another company's cockpit.
- If a project has no evidence for a metric, say so explicitly instead of estimating.

## Error handling

`POST /profile` returns HTTP 400 with `{ "error": "Invalid cockpit profile: ..." }`. The message contains the metric path and a fix hint. Read it, edit the profile, and resubmit. Never work around a cycle, unknown input, invalid aggregation or computed leaf.

`POST /metrics` returns HTTP 201 with `{ saved, savedIds, rejected, snapshotUpdatedAt }` when at least one value is accepted, or HTTP 400 with `{ error: "no valid metric values supplied", rejected }` when none is accepted. Every rejected row has `{ id, reason, message }`:

| reason | meaning | action |
| --- | --- | --- |
| `unknown-metric-id` | id is not in the active profile | add/fix the metric id or the profile |
| `metric-not-ingestible` | metric is `paperclip`, `static` or `computed` | do not retry; ingest a `snapshot` leaf instead |
| `invalid-value` | value is not a finite number | send a numeric value |
| `missing-or-invalid-asOf` | `asOf` is not ISO-8601 | send an ISO timestamp |
| `missing-id` | row has no metric id | add the id |

Governance rejections are top-level errors, not rejected rows: `governance-not-configured` (HTTP 409) means the board has not set the KM writer; `writer-not-authorized` (HTTP 403) means the caller is not the configured KM. Both are terminal; stop and escalate.

If the same error repeats twice, stop and report the exact `reason` and `message` to the CEO/human. Do not bypass the API, edit plugin state directly, or invent a value.

## Success checklist

- Governance is configured in company Plugin Settings; the caller is the configured Knowledge Manager writer.
- Snapshot values were written by the Knowledge Manager from Lead-provided evidence, not by the Lead directly.
- Profile validation passed; a `computed` metric has at least one input and a valid aggregation.
- Every leaf is `paperclip`, `snapshot` or `static`; no leaf is `computed`.
- Only `snapshot` ids were sent to `POST /metrics`; every accepted value has `asOf` and provenance.
- `GET /overview` shows the expected current/awaiting values; computed values are derived, not ingested.
- Every `awaiting-data` item has a named missing source and a follow-up issue for the owner.
