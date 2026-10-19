import { useMemo } from "react";
import type { DecisionGraph, DecisionGraphContext, DecisionGraphNode } from "@paperclipai/shared";
import { cn } from "../lib/utils";

type PositionedNode = DecisionGraphNode & { x: number; y: number };

function visibleGraph(context: DecisionGraphContext): DecisionGraph {
  const source = context.preview ?? context.graph ?? { nodes: [], edges: [] };
  return {
    nodes: source.nodes.slice(0, 12),
    edges: source.edges.slice(0, 24),
  };
}

function layout(graph: DecisionGraph): PositionedNode[] {
  const nodes = graph.nodes.slice(0, 12);
  return nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1) - Math.PI / 2;
    const radius = index === 0 ? 0 : 0.34;
    return {
      ...node,
      x: 50 + Math.cos(angle) * radius * 100,
      y: 50 + Math.sin(angle) * radius * 100,
    };
  });
}

function nodeClass(node: DecisionGraphNode) {
  if (node.change === "added") return "fill-emerald-500";
  if (node.change === "removed") return "fill-rose-500";
  if (node.change === "changed") return "fill-amber-500";
  return "fill-sky-600/80";
}

/**
 * Read-only graph evidence for an existing human approval gate.
 * This deliberately has no navigation, dialog, or full-graph entry point:
 * the bounded subgraph is the evidence; deeper context belongs in the Agent
 * conversation.
 */
export function GraphEvidencePanel({ context }: { context: DecisionGraphContext }) {
  const graph = visibleGraph(context);
  const positions = useMemo(() => layout(graph), [graph]);
  const byId = new Map(positions.map((node) => [node.id, node]));
  if (positions.length === 0) return null;
  const highlighted = new Set([
    ...(context.highlight?.added ?? []),
    ...(context.highlight?.removed ?? []),
    ...(context.highlight?.changed ?? []),
  ]);
  return (
    <section className="mt-4 rounded-lg border border-border/70 bg-muted/20 p-3" aria-label="Graph evidence">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">Graph evidence</p>
          {context.summary && <p className="truncate text-xs text-muted-foreground">{context.summary}</p>}
        </div>
        <span className="shrink-0 text-(length:--text-micro) text-muted-foreground">
          {graph.nodes.length} nodes · {graph.edges.length} relationships
        </span>
      </div>
      <svg viewBox="0 0 100 100" className="h-40 w-full" role="img" aria-label="Graph evidence subgraph">
        {graph.edges.map((edge, index) => {
          const source = byId.get(edge.sourceId);
          const target = byId.get(edge.targetId);
          if (!source || !target) return null;
          return (
            <line
              key={`${edge.sourceId}:${edge.targetId}:${index}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              className="stroke-border/70"
              strokeWidth={0.45}
            />
          );
        })}
        {positions.map((node) => (
          <g key={node.id}>
            <circle
              cx={node.x}
              cy={node.y}
              r={4.2}
              className={cn(nodeClass(node), highlighted.has(node.id) && "stroke-amber-400/90", "stroke-1")}
            />
            <text
              x={node.x}
              y={node.y + 7.8}
              textAnchor="middle"
              fontSize={2.5}
              className="fill-foreground"
            >
              {node.name.length > 22 ? `${node.name.slice(0, 21)}…` : node.name}
            </text>
          </g>
        ))}
      </svg>
    </section>
  );
}
