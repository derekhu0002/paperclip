export type DecisionGraphNodeChange = "added" | "removed" | "changed";

export interface DecisionGraphNode {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  status?: string | null;
  viewIds?: string[];
  attributes?: Record<string, unknown>;
  change?: DecisionGraphNodeChange | null;
}

export interface DecisionGraphEdge {
  id?: string;
  sourceId: string;
  targetId: string;
  type: string;
  name?: string | null;
  statement?: string | null;
  change?: DecisionGraphNodeChange | null;
}

export interface DecisionGraphView {
  id: string;
  name: string;
  parentId?: string | null;
}

export interface DecisionGraph {
  nodes: DecisionGraphNode[];
  edges: DecisionGraphEdge[];
  views?: DecisionGraphView[];
}

export interface DecisionGraphProvider {
  name: string;
  version?: string | null;
  fingerprint?: string | null;
  profileVersion?: string | null;
}

export interface DecisionGraphContext {
  /**
   * Version of the graph-context contract emitted by the external graph
   * framework. Paperclip does not interpret the framework; it only needs to
   * know whether the payload shape is one it can render. Missing means a
   * pre-versioning producer.
   */
  schemaVersion?: number;
  provider?: DecisionGraphProvider;
  projectId?: string;
  snapshotHash?: string;
  viewId?: string;
  focusElementIds: string[];
  preview?: DecisionGraph;
  graph?: DecisionGraph;
  highlight?: {
    added?: string[];
    removed?: string[];
    changed?: string[];
  };
  summary?: string;
  maxDepth?: number;
}

export const GRAPH_CONTEXT_SCHEMA_VERSION = 1;

export type GraphContextCompatibility = "supported" | "legacy" | "unsupported";

export function graphContextCompatibility(
  context: Pick<DecisionGraphContext, "schemaVersion"> | null | undefined,
): GraphContextCompatibility {
  if (!context || context.schemaVersion === undefined) return "legacy";
  return context.schemaVersion === GRAPH_CONTEXT_SCHEMA_VERSION ? "supported" : "unsupported";
}


const MAX_PREVIEW_NODES = 24;
const MAX_PREVIEW_EDGES = 48;
const MAX_GRAPH_NODES = 2_000;
const MAX_GRAPH_EDGES = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeGraph(value: unknown, maxNodes: number, maxEdges: number): DecisionGraph | null {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;
  const nodes = value.nodes.filter((node): node is DecisionGraphNode => (
    isRecord(node) && typeof node.id === "string" && typeof node.name === "string" && typeof node.type === "string"
  )).slice(0, maxNodes);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = value.edges.filter((edge): edge is DecisionGraphEdge => (
    isRecord(edge) &&
    typeof edge.sourceId === "string" &&
    typeof edge.targetId === "string" &&
    typeof edge.type === "string" &&
    nodeIds.has(edge.sourceId) &&
    nodeIds.has(edge.targetId)
  )).slice(0, maxEdges);
  const views = Array.isArray(value.views)
    ? value.views.filter((view): view is DecisionGraphView => (
      isRecord(view) && typeof view.id === "string" && typeof view.name === "string"
    ))
    : undefined;
  return {
    nodes,
    edges,
    ...(views ? { views } : {}),
  };
}

/**
 * Read the optional decision graph context from Decision.metadata.
 * The preview is bounded for cards; graph is the optional explorer payload.
 */
export function parseDecisionGraphContext(value: unknown): DecisionGraphContext | null {
  if (!isRecord(value)) return null;
  const focusElementIds = Array.isArray(value.focusElementIds)
    ? value.focusElementIds.filter((id): id is string => typeof id === "string").slice(0, 24)
    : [];
  if (!focusElementIds.length && !value.preview && !value.graph) return null;
  const preview = normalizeGraph(value.preview, MAX_PREVIEW_NODES, MAX_PREVIEW_EDGES);
  const graph = normalizeGraph(value.graph, MAX_GRAPH_NODES, MAX_GRAPH_EDGES);
  if (!preview && !graph) return null;
  const highlight = isRecord(value.highlight)
    ? {
      added: Array.isArray(value.highlight.added) ? value.highlight.added.filter((id): id is string => typeof id === "string") : [],
      removed: Array.isArray(value.highlight.removed) ? value.highlight.removed.filter((id): id is string => typeof id === "string") : [],
      changed: Array.isArray(value.highlight.changed) ? value.highlight.changed.filter((id): id is string => typeof id === "string") : [],
    }
    : undefined;
  const schemaVersion = typeof value.schemaVersion === "number" && Number.isFinite(value.schemaVersion)
    ? value.schemaVersion
    : undefined;
  const provider = isRecord(value.provider) && typeof value.provider.name === "string"
    ? {
      name: value.provider.name,
      version: typeof value.provider.version === "string" ? value.provider.version : null,
      fingerprint: typeof value.provider.fingerprint === "string" ? value.provider.fingerprint : null,
      profileVersion: typeof value.provider.profileVersion === "string" ? value.provider.profileVersion : null,
    }
    : undefined;
  return {
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
    ...(provider ? { provider } : {}),
    projectId: typeof value.projectId === "string" ? value.projectId : undefined,
    snapshotHash: typeof value.snapshotHash === "string" ? value.snapshotHash : undefined,
    viewId: typeof value.viewId === "string" ? value.viewId : undefined,
    focusElementIds,
    preview: preview ?? undefined,
    graph: graph ?? undefined,
    highlight,
    summary: typeof value.summary === "string" ? value.summary : undefined,
    maxDepth: typeof value.maxDepth === "number" && Number.isFinite(value.maxDepth) ? value.maxDepth : undefined,
  };
}

