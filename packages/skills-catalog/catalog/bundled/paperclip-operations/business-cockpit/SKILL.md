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
      "unit": "count",
      "direction": "higher-is-better",
      "target": 10,
      "warn": 5,
      "critical": 2,
      "source": "paperclip",
      "sourceRef": "delivery-throughput",
      "formula": "Issues completed in the last 30 days."
    }
  ],
  "drivers": [
    {
      "id": "wip",
      "label": "Work in Progress",
      "unit": "count",
      "direction": "lower-is-better",
      "target": 10,
      "warn": 20,
      "critical": 30,
      "source": "paperclip",
      "sourceRef": "wip",
      "formula": "Issues currently in progress.",
      "affects": ["delivery-throughput"]
    }
  ],
  "links": [
    { "from": "wip", "to": "delivery-throughput", "weight": 0.3 }
  ]
}
```

### Metric fields

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Lowercase slug, unique across results and drivers. |
| `label` | yes | Human-readable name. |
| `unit` | yes | `ratio`, `count`, `days`, `currency` or `score`. |
| `direction` | yes | `higher-is-better` or `lower-is-better`. |
| `target` | yes | Numeric target. |
| `warn` / `critical` | no | Thresholds used for the status badge. |
| `source` | yes | `paperclip`, `snapshot` or `static`. |
| `sourceRef` | for `paperclip` | Host-computed metric key. |
| `formula` | no | Plain-language formula shown in the UI. |
| `value` | for `static` | Fixed numeric value. |

A driver also requires `affects`: a non-empty array of result ids it is expected to move.

A link connects a driver id (`from`) to a result id (`to`) with a weight between `-1` and `1`. The cockpit ranks levers by driver gap multiplied by the absolute weight.

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
   - `paperclip` source where the host already computes it; `snapshot` for project-specific evidence.
3. `POST profile` with the full profile. It replaces the company's previous profile.
4. Collect snapshot values from the project graph, issues, runs or documents. Include `source`, `commit`, `digest`, `asOf` and a note with numerator/denominator.
5. `POST metrics` with only the values you can prove.
6. `GET overview` again. Report before/after values, levers, and every metric that is still `awaiting-data` and why.
7. Refresh periodically or when the project graph/schema changes. Ask project Leads for missing exports through issues.

## Guardrails

- Do not fabricate values. If a result cannot be computed, leave it `awaiting-data` and name the missing source.
- Do not write issues, goals, agents or project graphs from this skill.
- Do not install, upgrade or configure the plugin.
- Do not put secrets in notes, comments or descriptions.
- Keep every metric company-scoped; never read or write another company's cockpit.
- If a project has no evidence for a metric, say so explicitly instead of estimating.
