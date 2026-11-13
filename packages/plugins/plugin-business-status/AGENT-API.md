# Business Cockpit — Agent API

This plugin is a generic cockpit framework. It ships no business presets. A human or an Agent defines a company's cockpit as a JSON profile: the key results, the process drivers that move them, and the causal weights between them.

## Endpoints

All routes are scoped by `companyId` and accept a board session or an Agent API token.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/plugins/paperclip.business-status/api/overview?companyId=<id>` | Read the active profile, results, drivers and lever ranking. |
| POST | `/api/plugins/paperclip.business-status/api/profile` | Create or replace the company's cockpit profile. |
| POST | `/api/plugins/paperclip.business-status/api/metrics` | Upsert snapshot values for `source: "snapshot"` metrics. |

### Authentication

```http
Authorization: Bearer <board-or-agent-token>
Content-Type: application/json
```

If an Agent runs behind the Paperclip sandbox callback bridge, the bridge may not forward `/api/plugins/*`. In that case use the public Paperclip host URL with an Agent API key, or ask the host operator to expose the plugin tools/routes.

## Profile schema

```json
{
  "name": "QwenPaw Security Cockpit",
  "description": "Detection coverage, control mitigation and gap closure.",
  "results": [
    {
      "id": "detection-coverage-rate",
      "label": "Detection Coverage",
      "unit": "ratio",
      "direction": "higher-is-better",
      "target": 0.8,
      "warn": 0.6,
      "critical": 0.4,
      "source": "snapshot",
      "sourceRef": "detection-coverage-rate",
      "formula": "Attack Techniques with >=1 Detects relationship / all Attack Techniques"
    }
  ],
  "drivers": [
    {
      "id": "telemetry-source-coverage",
      "label": "Telemetry Source Coverage",
      "unit": "ratio",
      "direction": "higher-is-better",
      "target": 0.9,
      "warn": 0.7,
      "critical": 0.5,
      "source": "snapshot",
      "sourceRef": "telemetry-source-coverage",
      "affects": ["detection-coverage-rate"]
    }
  ],
  "links": [
    { "from": "telemetry-source-coverage", "to": "detection-coverage-rate", "weight": 0.4 }
  ]
}
```

### Metric fields

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Lowercase slug, unique across results and drivers. |
| `label` | yes | Human-readable name. |
| `unit` | yes | `ratio`, `count`, `days`, `currency`, or `score`. |
| `direction` | yes | `higher-is-better` or `lower-is-better`. |
| `target` | yes | Numeric target. |
| `warn` | no | Warning threshold (status is `warn` beyond it). |
| `critical` | no | Critical threshold (status is `critical` beyond it). |
| `source` | yes | `paperclip`, `snapshot`, or `static`. |
| `sourceRef` | for `paperclip` | Name of a host-computed metric (see below). |
| `formula` | no | Plain-language description shown in the UI. |
| `value` | for `static` | Fixed numeric value. |

A driver also requires `affects`: a non-empty array of result ids it is expected to move.

### Links

`from` must be a driver id, `to` must be a result id, and `weight` is a number between `-1` and `1`. The cockpit ranks levers by `driver gap × abs(weight)`.

## Host-computed metrics (`source: "paperclip"`)

Use `sourceRef` with one of these keys. The host computes them from Paperclip issues, goals and agents; no ingestion is needed.

| sourceRef | Unit | Formula |
| --- | --- | --- |
| `goal-progress` | ratio | Done issues under active goals / all issues under active goals. |
| `delivery-throughput` | count | Issues completed in the last 30 days. |
| `cycle-time` | days | Median `completedAt - startedAt` for issues completed in the last 30 days. |
| `budget-burn` | ratio | Sum of agent monthly spend / sum of agent monthly budget. |
| `risk-blocked` | count | Issues currently blocked. |
| `wip` | count | Issues currently in progress. |
| `queue-age` | days | Median age of todo issues. |
| `blocked-age` | count | Blocked issues blocked for more than 3 days. |
| `review-queue` | count | Issues currently in review. |
| `agent-availability` | ratio | Idle/running agents / non-terminated agents. |
| `cost-per-delivery` | currency | Agent monthly spend in USD / issues completed in the last 30 days. |

## Snapshot metrics (`source: "snapshot"`)

Use `sourceRef` as the stable key. Values are upserted with provenance:

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
- Missing values stay `awaiting-data`; the plugin never fills them with `0`.

## Agent workflow

1. `GET overview` to read the current profile and values.
2. Design a profile with 3–5 results and 3–8 drivers. Use `paperclip` metrics when the host already computes them; use `snapshot` for business-specific data; use `static` only for an intentional fixed value.
3. `POST profile` with the full profile. It replaces the company's previous profile.
4. `POST metrics` for snapshot values with evidence (`source`, `commit`, `digest`, `asOf`, `note`).
5. `GET overview` again and report the before/after values, levers and any `awaiting-data` gaps.

Do not fabricate values. If a result cannot be computed, leave it as `awaiting-data` and state what source is missing. Do not modify issues, goals, agents or project graphs from this plugin.

## UI editing

The cockpit page has a **Configure** button that opens a JSON editor for the active profile. The same profile can be written by an Agent through `POST profile`.
