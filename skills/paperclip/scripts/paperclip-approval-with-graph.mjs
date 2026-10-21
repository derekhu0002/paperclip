#!/usr/bin/env node
/**
 * Create a Paperclip board approval with a graph-context payload.
 *
 * This helper is the ArchGraph adapter, and it lives in the Paperclip
 * repository on purpose: Paperclip core knows nothing about any graph
 * framework, while the optional Paperclip skill knows how to read ArchGraph's
 * `design/KG/SystemArchitecture.json`.
 *
 * Output contract: paperclip.graph-context/v1
 *   { schemaVersion, provider, projectId?, snapshotHash, focusElementIds,
 *     preview: { nodes, edges, views? }, graph?, highlight?, summary? }
 *
 * A different graph framework can bypass the ArchGraph adapter entirely:
 *   --graph-context <file|->          read the payload as JSON
 *   --graph-context-cmd <command>     run a provider that prints the payload
 *   PAPERCLIP_GRAPH_CONTEXT_CMD       same as above, via environment
 *
 * This helper never writes a graph.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = 1;
const PROVIDER_NAME = "archgraph";
const DEFAULT_GRAPH = path.join("design", "KG", "SystemArchitecture.json");
const MAX_PREVIEW_NODES = 24;

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
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isGraph(value) {
  return isRecord(value) && Array.isArray(value.nodes) && Array.isArray(value.edges);
}
function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}
function attrs(value) {
  if (!Array.isArray(value)) return {};
  return Object.fromEntries(value
    .filter((entry) => entry && typeof entry.name === "string")
    .map((entry) => [entry.name, entry.value]));
}

function graphFile() {
  const explicit = arg("graph");
  if (explicit) return path.resolve(explicit);
  const root = process.env.ARGO_REPO_ROOT || process.cwd();
  return path.resolve(root, DEFAULT_GRAPH);
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
function neighborhood(graph, focusIds, maxNodes) {
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
  return {
    nodes,
    edges: graph.edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId)),
  };
}
function archgraphVersion() {
  for (const file of ["VERSION", "version"]) {
    const candidate = path.join(process.env.ARGO_HOME || "/root/.argo", file);
    if (existsSync(candidate)) return readFileSync(candidate, "utf8").trim();
  }
  return null;
}

function validateProviderPayload(parsed) {
  if (!isRecord(parsed)) throw new Error("Graph-context payload must be a JSON object.");
  if (!Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < 1) {
    throw new Error(
      "Graph-context payload is missing an integer schemaVersion. Update the provider; Paperclip will not guess the contract version.",
    );
  }
  if (!isRecord(parsed.provider) || typeof parsed.provider.name !== "string" || !parsed.provider.name) {
    throw new Error("Graph-context payload is missing provider.name.");
  }
  if (!isGraph(parsed.preview) && !isGraph(parsed.graph)) {
    throw new Error("Graph-context payload must contain preview or graph with nodes and edges arrays.");
  }
  if (typeof parsed.snapshotHash !== "string" || !parsed.snapshotHash) {
    throw new Error("Graph-context payload is missing snapshotHash.");
  }
  return parsed;
}

function readGraphContext() {
  const file = arg("graph-context");
  const command = arg("graph-context-cmd") ?? process.env.PAPERCLIP_GRAPH_CONTEXT_CMD;
  if (file === "-") return validateProviderPayload(JSON.parse(readFileSync(0, "utf8")));
  if (file) return validateProviderPayload(JSON.parse(readFileSync(file, "utf8")));
  if (command) {
    const raw = execSync(command, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Graph-context provider did not return JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    return validateProviderPayload(parsed);
  }

  const fileToRead = graphFile();
  if (!existsSync(fileToRead)) {
    throw new Error(
      `No ArchGraph document at ${fileToRead}. Pass --graph <path>, set ARGO_REPO_ROOT, ` +
        "or supply --graph-context / --graph-context-cmd for a different graph framework.",
    );
  }
  const rawGraph = readJson(fileToRead);
  const graph = normalizeGraph(rawGraph);
  const explicitFocus = args("focus").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  const degree = degreeMap(graph);
  const focusElementIds = (explicitFocus.length > 0
    ? explicitFocus
    : [...graph.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, 4).map((node) => node.id)
  ).filter((id) => graph.nodes.some((node) => node.id === id));
  const preview = neighborhood(
    graph,
    focusElementIds,
    Math.min(Number(arg("preview-nodes", "12")) || 12, MAX_PREVIEW_NODES),
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    provider: { name: PROVIDER_NAME, version: archgraphVersion() },
    projectId: arg("project-id", process.env.PAPERCLIP_PROJECT_ID ?? undefined),
    snapshotHash: createHash("sha256").update(JSON.stringify(rawGraph)).digest("hex"),
    focusElementIds,
    preview,
    highlight: { added: [], removed: [], changed: [] },
    summary: arg("summary-label", `Graph evidence from ${path.basename(fileToRead)}`),
  };
}

const graphContext = readGraphContext();
const taskId = required("PAPERCLIP_TASK_ID", process.env.PAPERCLIP_TASK_ID);
const title = required("title", arg("title"));
const summary = arg("summary", arg("body", "Please review the attached graph evidence."));
const recommendedAction = arg("recommended-action", "Approve this request after reviewing the graph evidence.");
const body = JSON.stringify({
  type: "request_board_approval",
  issueIds: [taskId],
  payload: {
    title,
    summary,
    recommendedAction,
    graphContext,
  },
});
if (arg("dry-run", null) === "true") {
  process.stdout.write(`${body}\n`);
  process.exit(0);
}
const apiUrl = required("PAPERCLIP_API_URL", process.env.PAPERCLIP_API_URL).replace(/\/$/, "");
const apiKey = required("PAPERCLIP_API_KEY", process.env.PAPERCLIP_API_KEY);
const companyId = required("PAPERCLIP_COMPANY_ID", process.env.PAPERCLIP_COMPANY_ID);
const response = await fetch(`${apiUrl}/api/companies/${companyId}/approvals`, {
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
