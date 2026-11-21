import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  useHostContext,
  useHostNavigation,
  usePluginAction,
  usePluginData,
  usePluginToast,
  type PluginPageProps,
  type PluginSidebarProps,
} from "@paperclipai/plugin-sdk/ui";
import { DATA_KEYS, PAGE_ROUTE } from "../constants.js";
import { layoutProjectTree, type ProjectTreeLayoutNode } from "../layout.js";
import {
  checkProjectReparent,
  projectDescendantIds,
  toProjectTreeData,
  type ProjectTreeData,
  type TreeAgent,
  type TreeProjectInput,
} from "../tree.js";

const MAX_MEMBER_CHIPS = 8;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const DRAG_THRESHOLD = 6;

const STYLES = `
.pt-root { display: flex; flex-direction: column; gap: 12px; }
.pt-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pt-stats { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: var(--text-compact, 13px); color: var(--muted-foreground); }
.pt-search { min-width: 200px; flex: 1 1 220px; height: 30px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--foreground); padding: 0 8px; font-size: var(--text-compact, 13px); }
.pt-btn { height: 28px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--foreground); font-size: 12px; cursor: pointer; }
.pt-btn:hover { background: var(--accent); }
.pt-btn[aria-pressed="true"] { background: var(--accent); }
.pt-canvas { position: relative; border: 1px solid var(--border); border-radius: 8px; background: var(--background); overflow: hidden; }
.pt-svg { display: block; width: 100%; height: 620px; touch-action: none; cursor: grab; }
.pt-svg[data-panning="true"] { cursor: grabbing; }
.pt-node-box { fill: var(--background); stroke: var(--border); stroke-width: 1; }
.pt-node-box[data-selected="true"] { stroke: var(--ring, var(--border)); stroke-width: 2; }
.pt-node-box[data-match="true"] { stroke: var(--sidebar-accent-foreground, var(--border)); stroke-width: 2; }
.pt-node-box[data-dim="true"] { opacity: 0.45; }
.pt-node-box[data-drop="true"] { stroke: var(--ring, var(--border)); stroke-width: 2; stroke-dasharray: 6 4; }
.pt-node:focus { outline: none; }
.pt-node:focus-visible .pt-node-box { stroke: var(--ring, var(--border)); stroke-width: 2; }
.pt-node-name { font-size: 13px; font-weight: 600; fill: var(--foreground); }
.pt-node-meta { font-size: 11px; fill: var(--muted-foreground); }
.pt-node-status { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; fill: var(--muted-foreground); }
.pt-edge { fill: none; stroke: var(--border); stroke-width: 1.4; }
.pt-edge[data-active="true"] { stroke: var(--ring, var(--border)); stroke-width: 2; }
.pt-panel { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.pt-panel-title { font-size: 14px; font-weight: 600; color: var(--foreground); }
.pt-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: var(--text-compact, 13px); color: var(--muted-foreground); }
.pt-label { text-transform: uppercase; letter-spacing: 0.04em; font-size: 11px; color: var(--muted-foreground); }
.pt-chip { padding: 1px 6px; border-radius: 4px; background: var(--accent); color: var(--foreground); text-decoration: none; }
.pt-chip:hover { text-decoration: underline; }
.pt-chip-muted { padding: 1px 6px; border-radius: 4px; background: var(--accent); color: var(--muted-foreground); }
.pt-link { color: var(--foreground); text-decoration: none; font-weight: 500; }
.pt-link:hover { text-decoration: underline; }
.pt-muted { color: var(--muted-foreground); font-size: var(--text-compact, 13px); }
.pt-error { color: var(--destructive, var(--foreground)); font-size: var(--text-compact, 13px); }
.pt-select { height: 30px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--foreground); padding: 0 6px; font-size: var(--text-compact, 13px); max-width: 280px; }
.pt-sidebar-link { display: flex; align-items: center; gap: 10px; margin: 0 8px; padding: 6px 8px; border-radius: 8px; color: color-mix(in srgb, var(--foreground) 80%, transparent); text-decoration: none; font-size: inherit; font-weight: inherit; transition: background-color 120ms ease, color 120ms ease; }
.pt-sidebar-link:hover { background: var(--sidebar-accent); color: var(--sidebar-accent-foreground); }
.pt-sidebar-link[aria-current="page"] { background: var(--sidebar-accent); color: var(--sidebar-accent-foreground); }
@media (pointer: coarse) { .pt-sidebar-link { padding-top: 4px; padding-bottom: 4px; } }
`;

function Styles(): ReactNode {
  return <style>{STYLES}</style>;
}

function treeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v4M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function AgentChip({ agent }: { agent: TreeAgent }) {
  const navigator = useHostNavigation();
  return (
    <span className="pt-row" style={{ gap: 4 }}>
      <a {...navigator.linkProps(`/agents/${agent.id}`)} className="pt-chip">
        {agent.title ?? agent.name}
      </a>
      {agent.leadsProject ? (
        <span className="pt-chip-muted">leads {agent.leadsProject.name}</span>
      ) : null}
    </span>
  );
}

function reasonText(reason: string | undefined) {
  switch (reason) {
    case "self": return "A project cannot be its own parent.";
    case "missing-parent": return "That parent project no longer exists.";
    case "archived-parent": return "An archived project cannot be a parent.";
    case "cycle": return "That move would put a project under its own descendant.";
    default: return "This move is not allowed.";
  }
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

export function ProjectTreePage(_props: PluginPageProps) {
  const context = useHostContext();
  const navigator = useHostNavigation();
  const toast = usePluginToast();
  const reparent = usePluginAction("reparent-project");
  const { data, loading, error, refresh } = usePluginData<ProjectTreeData>(DATA_KEYS.tree, {
    companyId: context.companyId,
  });

  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 24, y: 24 });
  const [drag, setDrag] = useState<{ id: string; offsetX: number; offsetY: number; x: number; y: number; overId: string | null; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const projects: TreeProjectInput[] = useMemo(
    () => (data?.projects ?? []).map((project) =>
      overrides[project.id] !== undefined ? { ...project, parentProjectId: overrides[project.id] } : project),
    [data, overrides],
  );
  const tree = useMemo(() => toProjectTreeData(projects, data?.agents ?? []), [projects, data]);
  const layout = useMemo(() => layoutProjectTree(tree.roots, collapsed), [tree, collapsed]);
  const selectedNode = useMemo(
    () => layout.nodes.find((node) => node.id === selectedId) ?? null,
    [layout, selectedId],
  );
  const forbiddenParents = useMemo(
    () => (selectedId ? projectDescendantIds(projects, selectedId) : new Set<string>()),
    [projects, selectedId],
  );
  const parentOptions = useMemo(
    () => projects.filter((project) => project.id !== selectedId && !forbiddenParents.has(project.id)),
    [projects, selectedId, forbiddenParents],
  );
  const matchedIds = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    return new Set(projects.filter((project) => project.name.toLowerCase().includes(needle)).map((project) => project.id));
  }, [projects, query]);

  function toLocal(clientX: number, clientY: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom };
  }

  async function moveProject(projectId: string, parentProjectId: string | null) {
    const check = checkProjectReparent(projects, projectId, parentProjectId);
    if (!check.ok) {
      toast({ title: "Cannot move project", body: reasonText(check.reason), tone: "error" });
      return;
    }
    const previous = overrides[projectId];
    setOverrides((current) => ({ ...current, [projectId]: parentProjectId }));
    try {
      await reparent({ companyId: context.companyId, projectId, parentProjectId });
      toast({ title: "Project moved", tone: "success" });
      refresh();
    } catch (moveError) {
      setOverrides((current) => {
        const next = { ...current };
        if (previous === undefined) delete next[projectId];
        else next[projectId] = previous;
        return next;
      });
      toast({
        title: "Move failed",
        body: moveError instanceof Error ? moveError.message : String(moveError),
        tone: "error",
      });
    }
  }

  function onNodePointerDown(event: ReactPointerEvent<SVGGElement>, node: ProjectTreeLayoutNode) {
    if (event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as SVGGElement).setPointerCapture(event.pointerId);
    const local = toLocal(event.clientX, event.clientY);
    setDrag({ id: node.id, offsetX: local.x - node.x, offsetY: local.y - node.y, x: local.x, y: local.y, overId: null, moved: false });
  }

  function onNodePointerMove(event: ReactPointerEvent<SVGGElement>) {
    if (!drag) return;
    const local = toLocal(event.clientX, event.clientY);
    const moved = drag.moved
      || Math.abs(local.x - (drag.x)) > DRAG_THRESHOLD
      || Math.abs(local.y - (drag.y)) > DRAG_THRESHOLD;
    const forbidden = projectDescendantIds(projects, drag.id);
    const over = layout.nodes.find((node) =>
      node.id !== drag.id
      && !forbidden.has(node.id)
      && local.x >= node.x && local.x <= node.x + node.width
      && local.y >= node.y && local.y <= node.y + node.height) ?? null;
    setDrag({ ...drag, x: local.x, y: local.y, overId: over?.id ?? null, moved: moved || Boolean(over) });
  }

  function onNodePointerUp(event: ReactPointerEvent<SVGGElement>) {
    if (!drag) return;
    const current = drag;
    setDrag(null);
    if (!current.moved) {
      setSelectedId(current.id);
      return;
    }
    setSelectedId(current.id);
    void moveProject(current.id, current.overId ?? null);
  }

  function onCanvasPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
    panStart.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  }

  function onCanvasPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!panStart.current) return;
    setPan({
      x: panStart.current.panX + (event.clientX - panStart.current.x),
      y: panStart.current.panY + (event.clientY - panStart.current.y),
    });
  }

  function onCanvasPointerUp() {
    panStart.current = null;
  }

  function fitToView() {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextZoom = Math.min(1.2, Math.max(MIN_ZOOM, Math.min((rect.width - 48) / Math.max(layout.width, 1), (rect.height - 48) / Math.max(layout.height, 1))));
    setZoom(nextZoom);
    setPan({ x: 24, y: 24 });
  }

  function toggleCollapsed(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!context.companyId) {
    return <p className="pt-muted">Select an organization to view its project tree.</p>;
  }
  if (loading && !data) return <p className="pt-muted">Loading project tree...</p>;
  if (error) return <p className="pt-error">{error.message}</p>;

  const roots = tree.roots;
  if (roots.length === 0) {
    return (
      <div>
        <Styles />
        <p className="pt-muted">No project tree yet. Create a project for a subsystem or module and set its parent project.</p>
      </div>
    );
  }

  return (
    <div className="pt-root">
      <Styles />
      <div className="pt-toolbar">
        <input
          className="pt-search"
          type="search"
          placeholder="Search projects..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search projects"
        />
        <button type="button" className="pt-btn" onClick={() => setZoom((value) => Math.max(MIN_ZOOM, Math.round((value - 0.1) * 10) / 10))} aria-label="Zoom out">-</button>
        <span className="pt-muted" style={{ minWidth: 42, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
        <button type="button" className="pt-btn" onClick={() => setZoom((value) => Math.min(MAX_ZOOM, Math.round((value + 0.1) * 10) / 10))} aria-label="Zoom in">+</button>
        <button type="button" className="pt-btn" onClick={fitToView}>Fit</button>
        <button type="button" className="pt-btn" onClick={() => setCollapsed(new Set(projects.map((project) => project.id)))}>Collapse all</button>
        <button type="button" className="pt-btn" onClick={() => setCollapsed(new Set())}>Expand all</button>
        <span className="pt-stats">
          <span>Projects: {tree.stats.projects}</span>
          <span>Agents: {tree.stats.agents}</span>
          <span className="pt-muted">Drag a project onto another to change its parent; drop on empty space to make it a root.</span>
        </span>
      </div>

      <div className="pt-canvas">
        <svg
          ref={svgRef}
          className="pt-svg"
          data-panning={panStart.current ? "true" : undefined}
          role="application"
          aria-label="Project tree"
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerUp}
        >
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {layout.edges.map((edge) => (
              <path
                key={`${edge.from}->${edge.to}`}
                className="pt-edge"
                d={edge.path}
                data-active={drag?.overId === edge.to || undefined}
              />
            ))}
            {layout.nodes.map((node) => {
              const isDragging = drag?.id === node.id;
              const x = isDragging && drag ? drag.x - drag.offsetX : node.x;
              const y = isDragging && drag ? drag.y - drag.offsetY : node.y;
              const memberCount = (node.node.pm ? 1 : 0) + node.node.team.length;
              const dim = matchedIds ? !matchedIds.has(node.id) : false;
              const match = matchedIds?.has(node.id) ?? false;
              return (
                <g
                  key={node.id}
                  className="pt-node"
                  transform={`translate(${x},${y})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${node.name}, ${node.status}, ${memberCount} members${node.hasChildren ? `, ${node.node.children.length} sub-projects` : ""}`}
                  aria-pressed={selectedId === node.id}
                  onPointerDown={(event) => onNodePointerDown(event, node)}
                  onPointerMove={onNodePointerMove}
                  onPointerUp={onNodePointerUp}
                  onPointerCancel={onNodePointerUp}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(node.id);
                    }
                  }}
                  style={{ cursor: isDragging ? "grabbing" : "grab", opacity: isDragging ? 0.75 : 1 }}
                >
                  <rect
                    className="pt-node-box"
                    width={node.width}
                    height={node.height}
                    rx={8}
                    data-selected={selectedId === node.id}
                    data-match={match}
                    data-dim={dim}
                    data-drop={drag?.overId === node.id}
                  />
                  <text className="pt-node-name" x={12} y={21}>{truncate(node.name, 30)}</text>
                  <text className="pt-node-status" x={node.width - 12} y={21} textAnchor="end">{truncate(node.status, 14)}</text>
                  <text className="pt-node-meta" x={12} y={40}>
                    {node.node.pm ? `Lead: ${truncate(node.node.pm.name, 24)}` : "No lead agent"}
                  </text>
                  <text className="pt-node-meta" x={12} y={58}>
                    {memberCount} members{node.hasChildren ? ` - ${node.node.children.length} sub-projects` : ""}
                    {node.collapsed ? " - collapsed" : ""}
                  </text>
                  {node.hasChildren ? (
                    <g
                      role="button"
                      aria-label={node.collapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
                      transform={`translate(${node.width - 20},${node.height - 14})`}
                      onPointerDown={(event) => { event.stopPropagation(); }}
                      onClick={(event) => { event.stopPropagation(); toggleCollapsed(node.id); }}
                      style={{ cursor: "pointer" }}
                    >
                      <circle r={8} fill="var(--accent)" />
                      <text x={0} y={3.5} textAnchor="middle" className="pt-node-meta">{node.collapsed ? "+" : "-"}</text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {selectedNode ? (
        <div className="pt-panel">
          <div className="pt-panel-title">
            <a {...navigator.linkProps(`/projects/${selectedNode.id}`)} className="pt-link">{selectedNode.name}</a>
            <span className="pt-chip-muted" style={{ marginLeft: 8 }}>{selectedNode.status}</span>
          </div>
          <div className="pt-row">
            <span className="pt-label">Lead</span>
            {selectedNode.node.pm ? (
              <a {...navigator.linkProps(`/agents/${selectedNode.node.pm.id}`)} className="pt-link">{selectedNode.node.pm.name}</a>
            ) : (
              <span className="pt-muted">No lead agent</span>
            )}
          </div>
          <div className="pt-row">
            <span className="pt-label">Team</span>
            {selectedNode.node.team.length === 0 ? <span className="pt-muted">No team members</span> : null}
            {selectedNode.node.team.slice(0, MAX_MEMBER_CHIPS).map((member) => (
              <AgentChip key={member.id} agent={member} />
            ))}
            {selectedNode.node.team.length > MAX_MEMBER_CHIPS ? (
              <span className="pt-chip-muted">+{selectedNode.node.team.length - MAX_MEMBER_CHIPS}</span>
            ) : null}
          </div>
          <div className="pt-row">
            <span className="pt-label">Parent</span>
            <select
              className="pt-select"
              value={projects.find((project) => project.id === selectedNode.id)?.parentProjectId ?? ""}
              onChange={(event) => { void moveProject(selectedNode.id, event.target.value || null); }}
              aria-label={`Parent project of ${selectedNode.name}`}
            >
              <option value="">No parent (root)</option>
              {parentOptions.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
            <span className="pt-muted">Or drag the project onto another node. One parent per project; cycles are rejected.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ProjectTreeSidebarLink(_props: PluginSidebarProps) {
  const navigator = useHostNavigation();
  const href = navigator.resolveHref(`/${PAGE_ROUTE}`);
  const pathname = typeof window === "undefined" ? "" : window.location.pathname;
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <Styles />
      <a
        {...navigator.linkProps(`/${PAGE_ROUTE}`)}
        className="pt-sidebar-link"
        aria-current={isActive ? "page" : undefined}
      >
        <span style={{ display: "inline-flex", flexShrink: 0 }}>{treeIcon()}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Project Tree
        </span>
      </a>
    </>
  );
}
