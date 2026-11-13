# Business Cockpit

`paperclip.business-status` is a company-scoped business operating cockpit for Paperclip. It puts key results on top and the process drivers that move them below, then ranks the levers to move first.

This is a framework, not a fixed KPI wall. It ships one editable profile model per company. A human can edit the JSON profile in the UI; an Agent can design or update it through the API. No business presets are hardcoded.

## Model

A profile has three parts:

- `results`: the outcomes the business is accountable for (3–5 recommended).
- `drivers`: the process metrics that influence the results, each with `affects`.
- `links`: causal edges from a driver to a result with a weight from -1 to 1.

The UI ranks levers by `driver gap × abs(weight)`. A driver with no gap does not appear as an actionable lever; if no configured driver explains a result gap, the UI says so instead of inventing a cause.

Metric sources:

- `paperclip`: computed by the host from issues, goals and agents.
- `snapshot`: ingested by a project/Agent with provenance.
- `static`: fixed value, only when intentional.

## UI

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
