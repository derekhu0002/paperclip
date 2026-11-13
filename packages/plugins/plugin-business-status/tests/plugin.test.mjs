import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const importDist = (relativePath) => import(pathToFileURL(join(root, relativePath)).href);
const readText = (relativePath) => readFileSync(join(root, relativePath), "utf8");
const manifest = (await importDist("dist/manifest.js")).default;
const logic = await importDist("dist/logic.js");
const profileModule = await importDist("dist/profile.js");

const now = Date.parse("2026-11-13T00:00:00Z");
const day = 86_400_000;
const issues = [
  { id: "i1", status: "done", goalId: "g1", createdAt: now - 10 * day, startedAt: now - 6 * day, completedAt: now - 2 * day },
  { id: "i2", status: "done", goalId: "g1", createdAt: now - 8 * day, startedAt: now - 5 * day, completedAt: now - 1 * day },
  { id: "i3", status: "in_progress", createdAt: now - 4 * day },
  { id: "i4", status: "todo", createdAt: now - 6 * day },
  { id: "i5", status: "blocked", blockedTransitionAt: now - 5 * day, createdAt: now - 9 * day },
  { id: "i6", status: "in_review", createdAt: now - 3 * day },
  { id: "i7", status: "done", createdAt: now - 50 * day, startedAt: now - 45 * day, completedAt: now - 40 * day },
];
const goals = [{ id: "g1", status: "active" }];
const agents = [
  { id: "a1", status: "idle", budgetMonthlyCents: 10000, spentMonthlyCents: 5000 },
  { id: "a2", status: "running", budgetMonthlyCents: 10000, spentMonthlyCents: 3000 },
];

const securityProfile = {
  name: "Test Security Cockpit",
  description: "Detection coverage and its drivers.",
  results: [
    {
      id: "detection-coverage-rate",
      label: "Detection Coverage",
      unit: "ratio",
      direction: "higher-is-better",
      target: 0.8,
      warn: 0.6,
      critical: 0.4,
      source: "snapshot",
      sourceRef: "detection-coverage-rate",
    },
  ],
  drivers: [
    {
      id: "telemetry-source-coverage",
      label: "Telemetry Source Coverage",
      unit: "ratio",
      direction: "higher-is-better",
      target: 0.9,
      warn: 0.7,
      critical: 0.5,
      source: "snapshot",
      sourceRef: "telemetry-source-coverage",
      affects: ["detection-coverage-rate"],
    },
    {
      id: "open-gap-count",
      label: "Open Gaps",
      unit: "count",
      direction: "lower-is-better",
      target: 0,
      warn: 5,
      critical: 10,
      source: "snapshot",
      sourceRef: "open-gap-count",
      affects: ["detection-coverage-rate"],
    },
  ],
  links: [
    { from: "telemetry-source-coverage", to: "detection-coverage-rate", weight: 0.4 },
    { from: "open-gap-count", to: "detection-coverage-rate", weight: -0.3 },
  ],
};

test("manifest exposes the generic cockpit contract in English", () => {
  assert.equal(manifest.id, "paperclip.business-status");
  assert.equal(manifest.apiVersion, 1);
  assert.equal(manifest.version, "1.3.2");
  assert.equal(manifest.displayName, "Business Cockpit");
  const slotTypes = manifest.ui.slots.map((slot) => slot.type).sort();
  assert.deepEqual(slotTypes, ["dashboardWidget", "page", "sidebar"]);
  const page = manifest.ui.slots.find((slot) => slot.type === "page");
  assert.equal(page.routePath, "business-status");
  assert.equal(page.exportName, "BusinessStatusPage");
  const routes = manifest.apiRoutes.map((route) => route.routeKey).sort();
  assert.deepEqual(routes, ["ingest-metrics", "overview", "save-profile"]);
  for (const capability of ["issues.read", "goals.read", "agents.read", "plugin.state.read", "plugin.state.write", "api.routes.register"]) {
    assert.ok(manifest.capabilities.includes(capability), capability);
  }
});

test("the starter profile is a valid, editable example", () => {
  const validation = profileModule.validateProfile(profileModule.STARTER_PROFILE);
  assert.equal(validation.ok, true);
  assert.equal(profileModule.STARTER_PROFILE.results.length, 1);
  assert.equal(profileModule.STARTER_PROFILE.drivers.length, 1);
  assert.equal(profileModule.STARTER_PROFILE.links.length, 1);
});

test("profile validation rejects malformed definitions", () => {
  const missingName = profileModule.validateProfile({ results: profileModule.STARTER_PROFILE.results, drivers: [], links: [] });
  assert.equal(missingName.ok, false);
  assert.ok(missingName.errors.some((error) => error.includes("name")));

  const badLink = profileModule.validateProfile({
    ...profileModule.STARTER_PROFILE,
    links: [{ from: "wip", to: "unknown-result", weight: 0.3 }],
  });
  assert.equal(badLink.ok, false);
  assert.ok(badLink.errors.some((error) => error.includes("result id")));

  const duplicate = profileModule.validateProfile({
    ...profileModule.STARTER_PROFILE,
    drivers: [{ ...profileModule.STARTER_PROFILE.drivers[0], id: "delivery-throughput" }],
    links: [],
  });
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.errors.some((error) => error.includes("duplicate")));

  const staticWithoutValue = profileModule.validateProfile({
    ...profileModule.STARTER_PROFILE,
    results: [{ ...profileModule.STARTER_PROFILE.results[0], source: "static" }],
  });
  assert.equal(staticWithoutValue.ok, false);
});

test("profile validation supports nested metric inputs and rejects cycles", () => {
  const nested = {
    name: "Nested Cockpit",
    results: [
      {
        id: "coverage",
        label: "Coverage",
        unit: "ratio",
        direction: "higher-is-better",
        target: 0.8,
        source: "snapshot",
        sourceRef: "coverage",
        inputs: ["telemetry", "validated"],
      },
    ],
    drivers: [
      {
        id: "telemetry",
        label: "Telemetry",
        unit: "ratio",
        direction: "higher-is-better",
        target: 0.9,
        source: "snapshot",
        sourceRef: "telemetry",
      },
      {
        id: "validated",
        label: "Validated",
        unit: "ratio",
        direction: "higher-is-better",
        target: 0.7,
        source: "snapshot",
        sourceRef: "validated",
        inputs: ["telemetry"],
      },
    ],
    links: [],
  };
  const valid = profileModule.validateProfile(nested);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.profile.results[0].inputs, [{ id: "telemetry" }, { id: "validated" }]);
  assert.deepEqual(valid.profile.drivers.find((driver) => driver.id === "validated").inputs, [{ id: "telemetry" }]);
  const payload = logic.buildCockpitPayload(valid.profile, {}, null, now, "company-1");
  assert.deepEqual(payload.drivers.find((driver) => driver.definition.id === "validated").definition.inputs, [{ id: "telemetry" }]);

  const cycle = profileModule.validateProfile({
    ...nested,
    drivers: nested.drivers.map((driver) =>
      driver.id === "validated" ? { ...driver, inputs: ["coverage"] } : driver,
    ),
  });
  assert.equal(cycle.ok, false);
  assert.ok(cycle.errors.some((error) => error.includes("cycle")));

  const linkCycle = profileModule.validateProfile({
    ...nested,
    drivers: nested.drivers.map((driver) =>
      driver.id === "validated" ? { ...driver, inputs: ["coverage"] } : driver,
    ),
    links: [{ from: "validated", to: "coverage", weight: 0.5 }],
  });
  assert.equal(linkCycle.ok, false);
  assert.ok(linkCycle.errors.some((error) => error.includes("cycle")));

  const weighted = profileModule.validateProfile({
    ...nested,
    results: [
      {
        ...nested.results[0],
        inputs: [
          { id: "telemetry", weight: -0.5, note: "opposite direction" },
          "validated",
        ],
      },
    ],
  });
  assert.equal(weighted.ok, true);
  assert.deepEqual(weighted.profile.results[0].inputs, [
    { id: "telemetry", weight: -0.5, note: "opposite direction" },
    { id: "validated" },
  ]);

  const unknown = profileModule.validateProfile({
    ...nested,
    results: [{ ...nested.results[0], inputs: ["missing"] }],
  });
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.some((error) => error.includes("unknown input")));

  const self = profileModule.validateProfile({
    ...nested,
    drivers: nested.drivers.map((driver) =>
      driver.id === "telemetry" ? { ...driver, inputs: ["telemetry"] } : driver,
    ),
  });
  assert.equal(self.ok, false);
  assert.ok(self.errors.some((error) => error.includes("own metric id")));
});

test("one driver can influence multiple results in a DAG", () => {
  const multi = {
    name: "Multi Result Cockpit",
    results: [
      {
        id: "coverage",
        label: "Coverage",
        unit: "ratio",
        direction: "higher-is-better",
        target: 0.8,
        source: "snapshot",
        sourceRef: "coverage",
      },
      {
        id: "mitigation",
        label: "Mitigation",
        unit: "ratio",
        direction: "higher-is-better",
        target: 0.6,
        source: "snapshot",
        sourceRef: "mitigation",
      },
    ],
    drivers: [
      {
        id: "telemetry",
        label: "Telemetry",
        unit: "ratio",
        direction: "higher-is-better",
        target: 0.9,
        source: "snapshot",
        sourceRef: "telemetry",
        affects: ["coverage", "mitigation"],
      },
    ],
    links: [
      { from: "telemetry", to: "coverage", weight: 0.4 },
      { from: "telemetry", to: "mitigation", weight: 0.3 },
    ],
  };
  const validation = profileModule.validateProfile(multi);
  assert.equal(validation.ok, true);
  const payload = logic.buildCockpitPayload(validation.profile, {}, null, now, "company-1");
  const driver = payload.drivers.find((entry) => entry.definition.id === "telemetry");
  assert.deepEqual(driver.impacts.map((impact) => impact.resultId).sort(), ["coverage", "mitigation"]);
});

test("default Paperclip metrics are computed from issues, goals and agents", () => {
  const computed = logic.computePaperclipMetrics({ issues, goals, agents, now });
  assert.equal(computed["goal-progress"].value, 1);
  assert.equal(computed["delivery-throughput"].value, 2);
  assert.equal(computed["cycle-time"].value, 4);
  assert.equal(computed["budget-burn"].value, 0.4);
  assert.equal(computed["risk-blocked"].value, 1);
  assert.equal(computed.wip.value, 1);
  assert.equal(computed["queue-age"].value, 6);
  assert.equal(computed["blocked-age"].value, 1);
  assert.equal(computed["review-queue"].value, 1);
  assert.equal(computed["agent-availability"].value, 1);
  assert.equal(computed["cost-per-delivery"].value, 40);
});

test("an unconfigured company returns an empty cockpit, not fabricated values", () => {
  const payload = logic.buildCockpitPayload(null, {}, null, now, "company-1");
  assert.equal(payload.configured, false);
  assert.equal(payload.profile, null);
  assert.equal(payload.business, null);
  assert.equal(payload.results.length, 0);
  assert.equal(payload.drivers.length, 0);
  assert.equal(payload.levers.length, 0);
});

test("configured cockpit merges Paperclip and snapshot metrics and ranks levers", () => {
  const computed = logic.computePaperclipMetrics({ issues, goals, agents, now });
  const defaultValidation = profileModule.validateProfile(profileModule.STARTER_PROFILE);
  assert.equal(defaultValidation.ok, true);
  const defaultPayload = logic.buildCockpitPayload(defaultValidation.profile, computed, null, now, "company-1");
  assert.equal(defaultPayload.configured, true);
  assert.equal(defaultPayload.results[0].definition.id, "delivery-throughput");
  assert.equal(defaultPayload.results[0].value, 2);
  assert.equal(defaultPayload.results[0].displayValue, "2");
  assert.ok(Array.isArray(defaultPayload.levers));

  const leverProfile = {
    name: "Lever Test",
    results: [
      {
        id: "throughput",
        label: "Throughput",
        unit: "count",
        direction: "higher-is-better",
        target: 10,
        warn: 5,
        critical: 2,
        source: "paperclip",
        sourceRef: "delivery-throughput",
      },
    ],
    drivers: [
      {
        id: "wip",
        label: "WIP",
        unit: "count",
        direction: "lower-is-better",
        target: 0,
        warn: 5,
        critical: 10,
        source: "paperclip",
        sourceRef: "wip",
        affects: ["throughput"],
      },
    ],
    links: [{ from: "wip", to: "throughput", weight: 0.5 }],
  };
  const leverValidation = profileModule.validateProfile(leverProfile);
  assert.equal(leverValidation.ok, true);
  const leverPayload = logic.buildCockpitPayload(leverValidation.profile, computed, null, now, "company-1");
  assert.equal(leverPayload.levers.length, 1);
  assert.ok(leverPayload.levers[0].impact > 0);

  const securityValidation = profileModule.validateProfile(securityProfile);
  assert.equal(securityValidation.ok, true);
  const snapshot = {
    schema: "paperclip.business-status.snapshot/v1",
    updatedAt: new Date(now).toISOString(),
    values: {
      "detection-coverage-rate": { value: 0.9677, asOf: new Date(now).toISOString(), source: "qwenpaw-blue", commit: "e0387e6" },
      "telemetry-source-coverage": { value: 1, asOf: new Date(now).toISOString(), source: "qwenpaw-blue" },
    },
  };
  const payload = logic.buildCockpitPayload(securityValidation.profile, {}, snapshot, now, "company-1");
  const detection = payload.results.find((result) => result.definition.id === "detection-coverage-rate");
  assert.equal(detection.state, "current");
  assert.equal(detection.status, "ok");
  const gaps = payload.drivers.find((driver) => driver.definition.id === "open-gap-count");
  assert.equal(gaps.state, "awaiting-data");
  assert.equal(gaps.value, null);
  assert.equal(gaps.displayValue, null);
  const telemetry = payload.drivers.find((driver) => driver.definition.id === "telemetry-source-coverage");
  assert.ok(telemetry.impacts.some((impact) => impact.resultId === "detection-coverage-rate" && impact.impact === 0));
});

test("snapshot ingest rejects unknown, invalid and asOf-less rows", () => {
  const allowed = profileModule.snapshotIdsForProfile(securityProfile);
  const { values, rejected } = logic.parseSnapshotValues(
    {
      values: [
        { id: "detection-coverage-rate", value: 0.5, asOf: "2026-11-13T00:00:00Z" },
        { id: "not-a-metric", value: 1, asOf: "2026-11-13T00:00:00Z" },
        { id: "telemetry-source-coverage", value: "bad", asOf: "2026-11-13T00:00:00Z" },
        { id: "open-gap-count", value: 3 },
        { id: "", value: 1, asOf: "2026-11-13T00:00:00Z" },
      ],
    },
    allowed,
  );
  assert.equal(values.length, 1);
  assert.equal(values[0].id, "detection-coverage-rate");
  assert.deepEqual(
    rejected.map((row) => row.reason).sort(),
    ["invalid-value", "missing-id", "missing-or-invalid-asOf", "unknown-metric-id"],
  );
});

test("empty or missing values array is rejected as a whole", () => {
  const allowed = profileModule.snapshotIdsForProfile(securityProfile);
  const empty = logic.parseSnapshotValues({ values: [] }, allowed);
  assert.equal(empty.values.length, 0);
  assert.equal(empty.rejected.length, 0);
  const missing = logic.parseSnapshotValues({}, allowed);
  assert.equal(missing.values.length, 0);
});

test("plugin source, README and bundled skill contain no Chinese characters", () => {
  const files = [
    "src/shared.ts",
    "src/logic.ts",
    "src/profile.ts",
    "src/worker.ts",
    "src/manifest.ts",
    "src/ui/index.tsx",
    "README.md",
    "../../skills-catalog/catalog/bundled/paperclip-operations/business-cockpit/SKILL.md",
  ];
  for (const file of files) {
    const text = readText(file);
    assert.equal(/[\u4e00-\u9fff]/.test(text), false, `${file} contains Chinese characters`);
  }
});


