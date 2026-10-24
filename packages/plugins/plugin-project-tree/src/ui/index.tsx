import { useState, type ReactNode } from "react";
import {
  useHostContext,
  useHostNavigation,
  usePluginData,
  type PluginPageProps,
  type PluginSidebarProps,
} from "@paperclipai/plugin-sdk/ui";
import { DATA_KEYS, PAGE_ROUTE } from "../constants.js";
import type { ProjectTreeData, ProjectTreeNode, TreeAgent } from "../tree.js";

const MAX_MEMBER_CHIPS = 10;

const STYLES = `
.pt-root { display: flex; flex-direction: column; gap: 16px; }
.pt-stats { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: var(--text-compact, 13px); color: var(--muted-foreground); }
.pt-panel { border: 1px solid var(--border); border-radius: var(--radius-md, 6px); padding: 4px 0; }
.pt-node-row { display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: var(--text-compact, 13px); }
.pt-toggle { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; padding: 0; border: none; background: transparent; color: var(--muted-foreground); cursor: pointer; }
.pt-toggle svg { transition: transform 120ms ease; }
.pt-toggle[aria-expanded="true"] svg { transform: rotate(90deg); }
.pt-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: var(--foreground); text-decoration: none; }
.pt-name:hover { text-decoration: underline; }
.pt-status { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted-foreground); }
.pt-count { font-size: 12px; color: var(--muted-foreground); }
.pt-team { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 0 12px 8px; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-md, 6px); font-size: var(--text-compact, 13px); }
.pt-team-label { text-transform: uppercase; letter-spacing: 0.04em; font-size: 11px; color: var(--muted-foreground); }
.pt-pm { font-weight: 500; color: var(--foreground); text-decoration: none; }
.pt-pm:hover { text-decoration: underline; }
.pt-chip { padding: 1px 6px; border-radius: 4px; background: var(--accent); color: var(--muted-foreground); text-decoration: none; }
.pt-chip:hover { text-decoration: underline; }
.pt-children { margin-left: 16px; border-left: 1px solid var(--border); padding-left: 8px; }
.pt-muted { color: var(--muted-foreground); font-size: var(--text-compact, 13px); }
.pt-error { color: var(--destructive, var(--foreground)); font-size: var(--text-compact, 13px); }
.pt-sidebar-link { display: flex; align-items: center; gap: 10px; padding: 6px 12px; border-radius: var(--radius-md, 6px); color: var(--foreground); text-decoration: none; font-size: inherit; font-weight: inherit; }
.pt-sidebar-link:hover { background: var(--accent); }
.pt-sidebar-link[aria-current="page"] { background: var(--accent); }
`;

function Styles(): ReactNode {
  return <style>{STYLES}</style>;
}

function chevron() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
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
  const hostNavigation = useHostNavigation();
  return (
    <a {...hostNavigation.linkProps(`/agents/${agent.id}`)} className="pt-chip">
      {agent.title ?? agent.name}
    </a>
  );
}

function ProjectNodeView({ node }: { node: ProjectTreeNode }) {
  const hostNavigation = useHostNavigation();
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const memberCount = (node.pm ? 1 : 0) + node.team.length;

  return (
    <div>
      <div className="pt-node-row">
        {hasChildren ? (
          <button
            type="button"
            className="pt-toggle"
            aria-expanded={expanded}
            aria-label={`${node.project.name} sub-projects`}
            onClick={() => setExpanded((current) => !current)}
          >
            {chevron()}
          </button>
        ) : (
          <span style={{ width: 16 }} />
        )}
        <a {...hostNavigation.linkProps(`/projects/${node.project.id}`)} className="pt-name">
          {node.project.name}
        </a>
        <span className="pt-status">{node.project.status}</span>
        <span className="pt-count">{memberCount} members</span>
      </div>

      <div className="pt-team">
        <span className="pt-team-label">Team</span>
        {node.pm ? (
          <a {...hostNavigation.linkProps(`/agents/${node.pm.id}`)} className="pt-pm">
            {node.pm.name}
          </a>
        ) : (
          <span className="pt-muted">No lead agent</span>
        )}
        {node.team.length === 0 && node.pm ? <span className="pt-muted">· no specialists</span> : null}
        {node.team.slice(0, MAX_MEMBER_CHIPS).map((member) => (
          <AgentChip key={member.id} agent={member} />
        ))}
        {node.team.length > MAX_MEMBER_CHIPS ? (
          <span className="pt-chip">+{node.team.length - MAX_MEMBER_CHIPS}</span>
        ) : null}
      </div>

      {hasChildren && expanded ? (
        <div className="pt-children">
          {node.children.map((child) => (
            <ProjectNodeView key={child.project.id} node={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ProjectTreePage(_props: PluginPageProps) {
  const context = useHostContext();
  const { data, loading, error } = usePluginData<ProjectTreeData>(DATA_KEYS.tree, {
    companyId: context.companyId,
  });

  if (!context.companyId) {
    return <p className="pt-muted">Select an organization to view its project tree.</p>;
  }
  if (loading && !data) return <p className="pt-muted">Loading project tree…</p>;
  if (error) return <p className="pt-error">{error.message}</p>;

  const roots = data?.roots ?? [];
  if (roots.length === 0) {
    return (
      <div>
        <Styles />
        <p className="pt-muted">
          No project tree yet. Create a project for a subsystem or module and set its parent project.
        </p>
      </div>
    );
  }

  return (
    <div className="pt-root">
      <Styles />
      <div className="pt-stats">
        <span>Projects: {data?.stats.projects ?? 0}</span>
        <span>Agents: {data?.stats.agents ?? 0}</span>
      </div>
      <div className="pt-panel">
        {roots.map((node) => (
          <ProjectNodeView key={node.project.id} node={node} />
        ))}
      </div>
    </div>
  );
}

export function ProjectTreeSidebarLink(_props: PluginSidebarProps) {
  const hostNavigation = useHostNavigation();
  const href = hostNavigation.resolveHref(`/${PAGE_ROUTE}`);
  const pathname = typeof window === "undefined" ? "" : window.location.pathname;
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <a
      {...hostNavigation.linkProps(`/${PAGE_ROUTE}`)}
      className="pt-sidebar-link"
      aria-current={isActive ? "page" : undefined}
    >
      <span style={{ display: "inline-flex", flexShrink: 0 }}>{treeIcon()}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        Project Tree
      </span>
    </a>
  );
}
