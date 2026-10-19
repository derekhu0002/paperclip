#!/usr/bin/env node
/**
 * Create a standalone Paperclip decision with a bounded project-graph context.
 *
 * This is the agent-side Phase 1 helper. It reads the project's canonical
 * design/KG/SystemArchitecture.json (or --graph), normalizes the graph, picks
 * focus nodes, and adds metadata.graphContext before POSTing the decision.
 * It never writes the graph.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}
function args(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) values.push(process.argv[i + 1]);
  }
  return values;
}
function required(name, value) {
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}
function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}
function attrs(value) {
  if (!Array.isArray(value)) return {};
  return Object.fromEntries(value.filter((entry) => entry && typeof entry.name === "string").map((entry) => [entry.name, entry.value]));
}
function normalizeGraph(raw) {
  const elements = Array.isArray(raw.elements) ? raw.elements : [];
  const relationships = Array.isArray(raw.relationships) ? raw.relationships : [];
  const views = Array.isArray(raw.views) ? raw.views : [];
  const viewIdsByElement = new Map();
  for (const view of views) {
    for (const id of view.included_elements ?? []) {
      const list = viewIdsByElement.get(id) ?? [];
      list.push(view.view_id);
      viewIdsByElement.set(id, list);
    }
  }
  const nodes = elements.map((element) => ({
    id: String(element.id),
    name: String(element.name ?? element.id),
    type: String(element.type ?? "Element"),
    description: typeof element.description === "string" ? element.description : null,
    attributes: attrs(element.attributes),
    viewIds: viewIdsByElement.get(element.id) ?? [],
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = relationships.filter((relationship) => (
    nodeIds.has(String(relationship.source_id)) && nodeIds.has(String(relationship.target_id))
  )).map((relationship) => ({
    id: relationship.id ? String(relationship.id) : undefined,
    sourceId: String(relationship.source_id),
    targetId: String(relationship.target_id),
    type: String(relationship.type ?? "Association"),
    name: typeof relationship.name === "string" ? relationship.name : null,
    statement: typeof relationship.statement === "string" ? relationship.statement : null,
  }));
  const graphViews = views.map((view) => ({
    id: String(view.view_id),
    name: String(view.view_name ?? view.view_id),
    parentId: view.parent_element_id ? String(view.parent_element_id) : null,
  }));
  return { nodes, edges, views: graphViews };
}
function degreeMap(graph) {
  const degree = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    degree.set(edge.sourceId, (degree.get(edge.sourceId) ?? 0) + 1);
    degree.set(edge.targetId, (degree.get(edge.targetId) ?? 0) + 1);
  }
  return degree;
}
function neighborhood(graph, focusIds, maxNodes = 12) {
  const adjacency = new Map();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.sourceId)) adjacency.set(edge.sourceId, new Set());
    if (!adjacency.has(edge.targetId)) adjacency.set(edge.targetId, new Set());
    adjacency.get(edge.sourceId).add(edge.targetId);
    adjacency.get(edge.targetId).add(edge.sourceId);
  }
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const selected = new Set(focusIds.filter((id) => byId.has(id)));
  for (const id of [...selected]) {
    for (const next of adjacency.get(id) ?? []) {
      if (selected.size >= maxNodes) break;
      selected.add(next);
    }
  }
  const nodes = [...selected].slice(0, maxNodes).map((id) => byId.get(id)).filter(Boolean);
  const ids = new Set(nodes.map((node) => node.id));
  return { nodes, edges: graph.edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId)) };
}

const graphFile = path.resolve(arg("graph", path.join(process.cwd(), "design", "KG", "SystemArchitecture.json")));
const rawGraph = readJson(graphFile);
const graph = normalizeGraph(rawGraph);
const graphHash = createHash("sha256").update(JSON.stringify(rawGraph)).digest("hex");
const explicitFocus = args("focus").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
const degree = degreeMap(graph);
const focusElementIds = (explicitFocus.length > 0
  ? explicitFocus
  : [...graph.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, 4).map((node) => node.id)
).filter((id) => graph.nodes.some((node) => node.id === id));
const preview = neighborhood(graph, focusElementIds, Number(arg("preview-nodes", "12")) || 12);
const payloadFile = arg("payload");
const payload = payloadFile
  ? readJson(path.resolve(payloadFile))
  : {
    title: required("title", arg("title")),
    body: required("body", arg("body")),
    options: [
      {
        id: "approve",
        label: arg("approve-label", "Approve"),
        description: "Approve the graph context and continue.",
        effects: process.env.PAPERCLIP_TASK_ID ? [{
          type: "comment_on_issue",
          targetIssueId: process.env.PAPERCLIP_TASK_ID,
          staleness: "lenient",
          bodyMarkdown: "Approved from the decision graph context.",
        }] : [],
      },
      { id: "reject", label: "Reject", effects: [] },
    ],
    idempotencyKey: arg("idempotency-key", null) ?? undefined,
    continuationPolicy: "wake_origin_agent",
  };
const metadata = {
  ...(payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}),
  graphContext: {
    projectId: arg("project-id", process.env.PAPERCLIP_PROJECT_ID ?? undefined),
    snapshotHash: graphHash,
    focusElementIds,
    preview,
    graph,
    highlight: { added: [], removed: [], changed: [] },
    summary: arg("summary", `Graph context from ${path.basename(graphFile)}`),
    maxDepth: 2,
  },
};
const body = JSON.stringify({ ...payload, metadata });
if (arg("dry-run", null) === "true") {
  process.stdout.write(`${body}\n`);
  process.exit(0);
}
const apiUrl = required("PAPERCLIP_API_URL", process.env.PAPERCLIP_API_URL).replace(/\/$/, "");
const apiKey = required("PAPERCLIP_API_KEY", process.env.PAPERCLIP_API_KEY);
const companyId = required("PAPERCLIP_COMPANY_ID", process.env.PAPERCLIP_COMPANY_ID);
const response = await fetch(`${apiUrl}/api/companies/${companyId}/decisions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-Paperclip-Run-Id": process.env.PAPERCLIP_RUN_ID ?? "",
  },
  body,
});
const text = await response.text();
if (!response.ok) {
  process.stderr.write(`${response.status} ${text}\n`);
  process.exit(1);
}
process.stdout.write(`${text}\n`);
