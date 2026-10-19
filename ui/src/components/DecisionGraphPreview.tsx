import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, Maximize2 } from "lucide-react";
import {
  parseDecisionGraphContext,
  type DecisionGraph,
  type DecisionGraphContext,
  type DecisionGraphNode,
} from "@paperclipai/shared";
import { decisionsApi } from "../api/decisions";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type PositionedNode = DecisionGraphNode & { x: number; y: number; depth: number };

function graphFromContext(context: DecisionGraphContext): DecisionGraph {
  return context.graph ?? context.preview ?? { nodes: [], edges: [] };
}

function adjacency(graph: DecisionGraph) {
  const map = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!map.has(edge.sourceId)) map.set(edge.sourceId, new Set());
    if (!map.has(edge.targetId)) map.set(edge.targetId, new Set());
    map.get(edge.sourceId)!.add(edge.targetId);
    map.get(edge.targetId)!.add(edge.sourceId);
  }
  return map;
}

function collectNeighborhood(graph: DecisionGraph, focusIds: string[], maxDepth = 2, maxNodes = 60) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacencyMap = adjacency(graph);
  const focus = focusIds.filter((id) => byId.has(id));
  const roots = focus.length > 0 ? focus : graph.nodes.slice(0, 1).map((node) => node.id);
  const selected = new Set<string>();
  const queued = roots.map((id) => ({ id, depth: 0 }));
  while (queued.length > 0 && selected.size < maxNodes) {
    const current = queued.shift()!;
    if (selected.has(current.id)) continue;
    selected.add(current.id);
    if (current.depth >= maxDepth) continue;
    for (const next of adjacencyMap.get(current.id) ?? []) {
      if (!selected.has(next) && queued.length + selected.size < maxNodes) {
        queued.push({ id: next, depth: current.depth + 1 });
      }
    }
  }
  const nodes = [...selected].map((id) => byId.get(id)!).filter(Boolean);
  const ids = new Set(nodes.map((node) => node.id));
  return { nodes, edges: graph.edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId)) };
}

function layoutGraph(graph: DecisionGraph, focusIds: string[]): PositionedNode[] {
  const neighborhood = collectNeighborhood(graph, focusIds, 2, 24);
  const byId = new Map(neighborhood.nodes.map((node) => [node.id, node]));
  const focus = focusIds.filter((id) => byId.has(id));
  const roots = focus.length > 0 ? focus : neighborhood.nodes.slice(0, 1).map((node) => node.id);
  const depthById = new Map<string, number>();
  const adjacencyMap = adjacency(neighborhood);
  const queue = roots.map((id) => ({ id, depth: 0 }));
  while (queue.length > 0) {
    const current = queue.shift()!;
    const prior = depthById.get(current.id);
    if (prior !== undefined && prior <= current.depth) continue;
    depthById.set(current.id, current.depth);
    if (current.depth >= 2) continue;
    for (const next of adjacencyMap.get(current.id) ?? []) {
      if (byId.has(next)) queue.push({ id: next, depth: current.depth + 1 });
    }
  }
  const byDepth = new Map<number, DecisionGraphNode[]>();
  for (const node of neighborhood.nodes) {
    const depth = depthById.get(node.id) ?? 2;
    const bucket = byDepth.get(depth) ?? [];
    bucket.push(node);
    byDepth.set(depth, bucket);
  }
  const positioned: PositionedNode[] = [];
  for (const [depth, nodes] of byDepth) {
    const radius = depth === 0 ? 0 : depth === 1 ? 0.28 : 0.42;
    nodes.forEach((node, index) => {
      const angle = depth === 0
        ? 0
        : (Math.PI * 2 * index) / Math.max(nodes.length, 1) - Math.PI / 2 + (depth * 0.35);
      positioned.push({ ...node, depth, x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius });
    });
  }
  return positioned;
}

function nodeClass(node: DecisionGraphNode, focused: boolean) {
  if (node.change === "added") return "fill-emerald-500";
  if (node.change === "removed") return "fill-rose-500";
  if (node.change === "changed") return "fill-amber-500";
  if (focused) return "fill-primary";
  return "fill-sky-600/80";
}

function GraphCanvas({
  graph,
  context,
  selectedId,
  onSelect,
  compact = false,
}: {
  graph: DecisionGraph;
  context: DecisionGraphContext;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  compact?: boolean;
}) {
  const positions = useMemo(() => layoutGraph(graph, context.focusElementIds), [graph, context.focusElementIds]);
  const byId = new Map(positions.map((node) => [node.id, node]));
  const focusSet = new Set(context.focusElementIds);
  const highlighted = new Set([
    ...(context.highlight?.added ?? []),
    ...(context.highlight?.removed ?? []),
    ...(context.highlight?.changed ?? []),
  ]);
  if (positions.length === 0) return null;
  return (
    <svg
      viewBox="0 0 100 100"
      className={cn("h-full w-full", compact ? "min-h-36" : "min-h-0")}
      role="img"
      aria-label="Decision knowledge graph"
    >
      {graph.edges.map((edge, index) => {
        const source = byId.get(edge.sourceId);
        const target = byId.get(edge.targetId);
        if (!source || !target) return null;
        const active = selectedId === edge.sourceId || selectedId === edge.targetId;
        return (
          <line
            key={`${edge.sourceId}:${edge.targetId}:${index}`}
            x1={source.x * 100}
            y1={source.y * 100}
            x2={target.x * 100}
            y2={target.y * 100}
            className={cn("stroke-border", active ? "stroke-primary/70" : "stroke-border/60")}
            strokeWidth={active ? 0.7 : 0.4}
          />
        );
      })}
      {positions.map((node) => {
        const focused = focusSet.has(node.id);
        const selected = selectedId === node.id;
        return (
          <g
            key={node.id}
            onClick={() => onSelect?.(node.id)}
            className={onSelect ? "cursor-pointer" : undefined}
            role={onSelect ? "button" : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onKeyDown={(event) => {
              if (onSelect && (event.key === "Enter" || event.key === " ")) onSelect(node.id);
            }}
          >
            <circle
              cx={node.x * 100}
              cy={node.y * 100}
              r={focused ? 4.6 : 3.5}
              className={cn(
                nodeClass(node, focused),
                selected && "stroke-foreground",
                "stroke-1",
              )}
            />
            {(
              <text
                x={node.x * 100}
                y={node.y * 100 + (focused ? 7.5 : 6.4)}
                textAnchor="middle"
                fontSize={compact ? 2.4 : 2.2}
                className="fill-foreground"
              >
                {node.name.length > 24 ? `${node.name.slice(0, 23)}…` : node.name}
              </text>
            )}
            {highlighted.has(node.id) && (
              <circle
                cx={node.x * 100}
                cy={node.y * 100}
                r={focused ? 6.2 : 5}
                className="fill-none stroke-amber-400/80"
                strokeWidth={0.7}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function DecisionGraphPreview({
  decisionId,
  context,
}: {
  decisionId: string;
  context: DecisionGraphContext;
}) {
  const [open, setOpen] = useState(false);
  const graph = graphFromContext(context);
  const previewGraph = context.preview ?? graph;
  if (previewGraph.nodes.length === 0) return null;

  return (
    <>
      <div className="mt-3 overflow-hidden rounded-lg border border-border/70 bg-muted/20">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-xs font-medium">Graph context</span>
            {context.summary && (
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">{context.summary}</span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-7 shrink-0 gap-1"
            onClick={() => setOpen(true)}
          >
            <Maximize2 className="h-3 w-3" />
            Open graph
          </Button>
        </div>
        <button
          type="button"
          className="block h-40 w-full text-left"
          onClick={() => setOpen(true)}
          aria-label="Open decision graph context"
        >
          <GraphCanvas graph={previewGraph} context={context} compact />
        </button>
      </div>
      <DecisionGraphExplorer open={open} onOpenChange={setOpen} decisionId={decisionId} context={context} />
    </>
  );
}

export function DecisionGraphExplorer({
  open,
  onOpenChange,
  decisionId,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  decisionId: string;
  context: DecisionGraphContext;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(context.viewId ?? null);
  const [showAll, setShowAll] = useState(false);
  const { data: detail } = useQuery({
    queryKey: ["decisions", "detail", decisionId],
    queryFn: () => decisionsApi.get(decisionId),
    enabled: open,
  });
  const detailContext = detail ? (contextFromMetadata(detail.metadata) ?? context) : context;
  const fullGraph = detailContext.graph ?? detailContext.preview ?? context.graph ?? context.preview ?? { nodes: [], edges: [] };
  const views = fullGraph.views ?? [];
  const selectedView = views.find((view) => view.id === viewId) ?? null;
  const viewGraph = useMemo(() => {
    if (!viewId) return fullGraph;
    const nodeIds = new Set(fullGraph.nodes.filter((node) => node.viewIds?.includes(viewId)).map((node) => node.id));
    return {
      nodes: fullGraph.nodes.filter((node) => nodeIds.has(node.id)),
      edges: fullGraph.edges.filter((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId)),
      views: fullGraph.views,
    };
  }, [fullGraph, viewId]);
  const explorerGraph = showAll && viewId
    ? { ...viewGraph, nodes: viewGraph.nodes.slice(0, 120), edges: viewGraph.edges.slice(0, 240) }
    : collectNeighborhood(viewGraph, detailContext.focusElementIds, 2, 80);
  const selected = explorerGraph.nodes.find((node) => node.id === selectedId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-4 py-3 sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4" />
            Decision graph
          </DialogTitle>
          <DialogDescription>
            Explore the evidence behind this decision. Graph is read-only.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="flex w-full shrink-0 flex-col gap-3 border-b border-border p-3 md:w-56 md:border-b-0 md:border-r">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="decision-graph-view">
              View
            </label>
            <select
              id="decision-graph-view"
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={viewId ?? ""}
              onChange={(event) => setViewId(event.target.value || null)}
            >
              <option value="">Focused neighborhood</option>
              {views.map((view) => (
                <option key={view.id} value={view.id}>{view.name}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showAll && Boolean(viewId)}
                disabled={!viewId}
                onChange={(event) => setShowAll(event.target.checked)}
              />
              Show entire selected view
            </label>
            <p className="text-xs text-muted-foreground">
              {explorerGraph.nodes.length} nodes · {explorerGraph.edges.length} relationships
              {fullGraph.nodes.length > explorerGraph.nodes.length ? " · bounded preview" : ""}
            </p>
            {detailContext.snapshotHash && (
              <p className="break-all text-(length:--text-micro) text-muted-foreground">
                snapshot {detailContext.snapshotHash.slice(0, 12)}
              </p>
            )}
          </aside>
          <div className="relative min-h-72 flex-1 bg-muted/10">
            {explorerGraph.nodes.length > 0 ? (
              <GraphCanvas
                graph={explorerGraph}
                context={detailContext}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                No graph context is available for this decision.
              </div>
            )}
            {selectedView && (
              <div className="absolute left-3 top-3 rounded-md border border-border bg-background/90 px-2 py-1 text-xs text-muted-foreground">
                {selectedView.name}
              </div>
            )}
          </div>
          <aside className="w-full shrink-0 overflow-y-auto border-t border-border p-3 md:w-72 md:border-t-0 md:border-l">
            {selected ? (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{selected.type}</p>
                  <h3 className="mt-1 text-sm font-semibold">{selected.name}</h3>
                </div>
                {selected.description && (
                  <p className="text-xs leading-5 text-muted-foreground">{selected.description}</p>
                )}
                {selected.status && (
                  <p className="text-xs"><span className="text-muted-foreground">Status:</span> {selected.status}</p>
                )}
                {selected.change && (
                  <p className="text-xs"><span className="text-muted-foreground">Change:</span> {selected.change}</p>
                )}
                <div className="space-y-1 border-t border-border pt-2">
                  <p className="text-xs font-medium text-muted-foreground">Connections</p>
                  {explorerGraph.edges
                    .filter((edge) => edge.sourceId === selected.id || edge.targetId === selected.id)
                    .map((edge, index) => {
                      const otherId = edge.sourceId === selected.id ? edge.targetId : edge.sourceId;
                      const other = explorerGraph.nodes.find((node) => node.id === otherId);
                      return (
                        <button
                          key={`${edge.sourceId}:${edge.targetId}:${index}`}
                          type="button"
                          className="block w-full truncate text-left text-xs text-primary hover:underline"
                          onClick={() => setSelectedId(otherId)}
                        >
                          {edge.type} · {other?.name ?? otherId}
                        </button>
                      );
                    })}
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Select a node</p>
                <p>Click any node to inspect its type, evidence and connections.</p>
              </div>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function contextFromMetadata(metadata: unknown): DecisionGraphContext | null {
  if (!metadata || typeof metadata !== "object") return null;
  return parseDecisionGraphContext((metadata as Record<string, unknown>).graphContext);
}
