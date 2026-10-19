import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DecisionGraph, DecisionGraphContext, DecisionGraphNode } from "@paperclipai/shared";

type CardBox = {
  node: DecisionGraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

type GraphHover = {
  node: DecisionGraphNode;
  x: number;
  y: number;
};

const CARD_HEIGHT = 58;
const CARD_GAP_X = 18;
const CARD_GAP_Y = 26;

function visibleGraph(context: DecisionGraphContext): DecisionGraph {
  const source = context.preview ?? context.graph ?? { nodes: [], edges: [] };
  return {
    nodes: source.nodes.slice(0, 12),
    edges: source.edges.slice(0, 24),
  };
}

function color(style: CSSStyleDeclaration, token: string, fallback: string) {
  return style.getPropertyValue(token).trim() || fallback;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 0 && ctx.measureText(`${value}...`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return value.length > 0 ? `${value}...` : "";
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function nodeAccent(style: CSSStyleDeclaration, node: DecisionGraphNode) {
  if (node.change === "added") return color(style, "--color-emerald-500", "green");
  if (node.change === "removed") return color(style, "--color-rose-500", "red");
  if (node.change === "changed") return color(style, "--color-amber-500", "orange");
  return color(style, "--color-primary", "currentColor");
}

function edgeTarget(box: CardBox, target: CardBox) {
  const dx = target.centerX - box.centerX;
  const dy = target.centerY - box.centerY;
  if (dx === 0 && dy === 0) return null;
  const tx = (target.width / 2 + 5) / Math.max(Math.abs(dx), 1);
  const ty = (target.height / 2 + 5) / Math.max(Math.abs(dy), 1);
  const t = Math.min(tx, ty);
  return {
    x: target.centerX - dx * t,
    y: target.centerY - dy * t,
    angle: Math.atan2(dy, dx),
  };
}

export function GraphEvidencePanel({ context }: { context: DecisionGraphContext }) {
  const graph = useMemo(() => visibleGraph(context), [context]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cardsRef = useRef<CardBox[]>([]);
  const [hover, setHover] = useState<GraphHover | null>(null);
  const hoveredId = hover?.node.id ?? null;
  const focusIds = useMemo(() => new Set(context.focusElementIds), [context.focusElementIds]);
  const highlighted = useMemo(
    () =>
      new Set([
        ...(context.highlight?.added ?? []),
        ...(context.highlight?.removed ?? []),
        ...(context.highlight?.changed ?? []),
      ]),
    [context.highlight],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let animationFrame = 0;
    let lastWidth = 0;
    const schedule = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)) as typeof requestAnimationFrame;
    const cancel = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;

    const draw = () => {
      const width = Math.floor(wrap.clientWidth);
      if (width <= 0) return;
      const columns = width >= 900 ? 4 : width >= 600 ? 3 : 2;
      const rows = Math.ceil(graph.nodes.length / columns);
      const available = width - 28;
      const cardWidth = Math.max(132, Math.min(218, (available - CARD_GAP_X * (columns - 1)) / columns));
      const totalWidth = cardWidth * columns + CARD_GAP_X * (columns - 1);
      const height = Math.max(250, rows * CARD_HEIGHT + (rows - 1) * CARD_GAP_Y + 48);
      const startX = Math.max(14, (width - totalWidth) / 2);
      const startY = 24;
      const dpr = window.devicePixelRatio || 1;
      const style = getComputedStyle(canvas);
      const foreground = color(style, "--color-foreground", "currentColor");
      const muted = color(style, "--color-muted-foreground", "gray");
      const border = color(style, "--color-border", "gray");
      const card = color(style, "--color-card", "white");
      const primary = color(style, "--color-primary", "currentColor");
      const fontFamily = style.fontFamily || "sans-serif";

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.height = `${height}px`;
      let ctx: CanvasRenderingContext2D | null = null;
      try {
        ctx = canvas.getContext("2d");
      } catch {
        return;
      }
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const cards: CardBox[] = graph.nodes.map((node, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = startX + column * (cardWidth + CARD_GAP_X);
        const y = startY + row * (CARD_HEIGHT + CARD_GAP_Y);
        return {
          node,
          x,
          y,
          width: cardWidth,
          height: CARD_HEIGHT,
          centerX: x + cardWidth / 2,
          centerY: y + CARD_HEIGHT / 2,
        };
      });
      cardsRef.current = cards;
      const byId = new Map(cards.map((cardBox) => [cardBox.node.id, cardBox]));

      for (const edge of graph.edges) {
        const source = byId.get(edge.sourceId);
        const target = byId.get(edge.targetId);
        if (!source || !target) continue;
        const endpoint = edgeTarget(source, target);
        if (!endpoint) continue;
        const active = focusIds.has(edge.sourceId) || focusIds.has(edge.targetId);
        ctx.save();
        ctx.globalAlpha = active ? 0.62 : 0.3;
        ctx.strokeStyle = active ? primary : border;
        ctx.lineWidth = active ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(source.centerX, source.centerY);
        ctx.lineTo(endpoint.x, endpoint.y);
        ctx.stroke();
        ctx.globalAlpha = active ? 0.72 : 0.38;
        ctx.fillStyle = active ? primary : border;
        ctx.beginPath();
        ctx.moveTo(endpoint.x, endpoint.y);
        ctx.lineTo(
          endpoint.x - Math.cos(endpoint.angle - Math.PI / 6) * 7,
          endpoint.y - Math.sin(endpoint.angle - Math.PI / 6) * 7,
        );
        ctx.lineTo(
          endpoint.x - Math.cos(endpoint.angle + Math.PI / 6) * 7,
          endpoint.y - Math.sin(endpoint.angle + Math.PI / 6) * 7,
        );
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      for (const cardBox of cards) {
        const focused = focusIds.has(cardBox.node.id);
        const selected = hoveredId === cardBox.node.id;
        const changed = highlighted.has(cardBox.node.id);
        ctx.save();
        roundRect(ctx, cardBox.x, cardBox.y, cardBox.width, cardBox.height, 8);
        ctx.fillStyle = card;
        ctx.fill();
        ctx.lineWidth = focused || selected ? 2 : 1;
        ctx.strokeStyle = focused || selected ? primary : border;
        ctx.stroke();

        ctx.save();
        roundRect(ctx, cardBox.x + 1, cardBox.y + 1, 3, cardBox.height - 2, 2);
        ctx.clip();
        ctx.fillStyle = nodeAccent(style, cardBox.node);
        ctx.fillRect(cardBox.x + 1, cardBox.y + 1, 3, cardBox.height - 2);
        ctx.restore();

        if (changed) {
          ctx.strokeStyle = color(style, "--color-amber-500", "orange");
          ctx.lineWidth = 1.5;
          roundRect(ctx, cardBox.x + 2, cardBox.y + 2, cardBox.width - 4, cardBox.height - 4, 6);
          ctx.stroke();
        }

        const textLeft = cardBox.x + 12;
        const textWidth = cardBox.width - 24;
        ctx.fillStyle = foreground;
        ctx.font = `600 12px ${fontFamily}`;
        ctx.textBaseline = "middle";
        ctx.fillText(truncate(ctx, cardBox.node.name, textWidth), textLeft, cardBox.y + 21);
        ctx.fillStyle = muted;
        ctx.font = `11px ${fontFamily}`;
        const type = cardBox.node.type || "Element";
        const change = cardBox.node.change ? ` · ${cardBox.node.change}` : "";
        ctx.fillText(truncate(ctx, `${type}${change}`, textWidth), textLeft, cardBox.y + 40);
        ctx.restore();
      }
      lastWidth = width;
    };

    const scheduleDraw = () => {
      cancel(animationFrame);
      animationFrame = schedule(draw);
    };

    scheduleDraw();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
      const width = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (width !== lastWidth) scheduleDraw();
    });
    resizeObserver?.observe(wrap);
    const themeObserver = new MutationObserver(scheduleDraw);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });

    return () => {
      cancel(animationFrame);
      resizeObserver?.disconnect();
      themeObserver.disconnect();
    };
  }, [graph, focusIds, highlighted, hoveredId]);

  if (graph.nodes.length === 0) return null;

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const card = cardsRef.current.find(
      (item) => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height,
    );
    setHover((current) => {
      if (!card) return current === null ? current : null;
      if (current?.node.id === card.node.id && current.x === x && current.y === y) return current;
      return { node: card.node, x, y };
    });
  };

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
      <div ref={wrapRef} className="relative">
        <canvas
          ref={canvasRef}
          className="block w-full rounded-md"
          role="img"
          aria-label="Graph evidence canvas"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        />
        {hover && (
          <div
            className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-border bg-popover px-2.5 py-2 text-popover-foreground shadow-md"
            style={{
              left: Math.max(8, Math.min(hover.x + 12, (wrapRef.current?.clientWidth ?? 0) - 240)),
              top: hover.y + 12,
            }}
          >
            <p className="text-xs font-medium">{hover.node.name}</p>
            <p className="mt-0.5 text-(length:--text-micro) text-muted-foreground">
              {hover.node.type ?? "Element"}{hover.node.change ? ` · ${hover.node.change}` : ""}
            </p>
            {hover.node.description && (
              <p className="mt-1 line-clamp-3 text-(length:--text-micro) leading-4 text-muted-foreground">
                {hover.node.description}
              </p>
            )}
          </div>
        )}
      </div>
      <ul className="sr-only" aria-label="Graph evidence nodes">
        {graph.nodes.map((node) => (
          <li key={node.id}>{`${node.name} (${node.type ?? "Element"})`}</li>
        ))}
      </ul>
    </section>
  );
}
