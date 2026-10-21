import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl, cn, formatNumber, projectUrl } from "../lib/utils";
import { buildProjectTree, type ProjectTreeNode } from "../lib/projectTree";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { ChevronRight, Network } from "lucide-react";

const MAX_MEMBER_CHIPS = 10;

function ProjectNode({ node }: { node: ProjectTreeNode }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const members = node.pm ? [node.pm, ...node.team] : node.team;

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        {hasChildren ? (
          <button
            type="button"
            className="p-0.5"
            onClick={() => setExpanded((current) => !current)}
            aria-label={`${node.project.name} sub-projects`}
            aria-expanded={expanded}
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
          </button>
        ) : (
          <span className="w-4" />
        )}
        <Link to={projectUrl(node.project)} className="min-w-0 flex-1 truncate font-medium hover:underline">
          {node.project.name}
        </Link>
        <StatusBadge status={node.project.status} />
        <span className="text-xs text-muted-foreground">{formatNumber(members.length)} members</span>
      </div>

      <div className="mx-3 mb-2 rounded-md border border-border bg-muted/30 p-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="uppercase tracking-wide text-muted-foreground">Team</span>
          {node.pm ? (
            <Link to={agentUrl(node.pm)} className="font-medium hover:underline">
              {node.pm.name}
            </Link>
          ) : (
            <span className="text-muted-foreground">No lead agent</span>
          )}
          {node.team.length === 0 && node.pm && (
            <span className="text-muted-foreground">· no specialists</span>
          )}
          {node.team.slice(0, MAX_MEMBER_CHIPS).map((member) => (
            <Link
              key={member.id}
              to={agentUrl(member)}
              className="rounded-sm bg-background px-1.5 py-0.5 text-muted-foreground hover:underline"
            >
              {member.title ?? member.name}
            </Link>
          ))}
          {node.team.length > MAX_MEMBER_CHIPS && (
            <span className="rounded-sm bg-background px-1.5 py-0.5 text-muted-foreground">
              +{node.team.length - MAX_MEMBER_CHIPS}
            </span>
          )}
        </div>
      </div>

      {hasChildren && expanded && (
        <div className="ml-4 border-l border-border pl-2">
          {node.children.map((child) => (
            <ProjectNode key={child.project.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Organization() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Organization" }]);
  }, [setBreadcrumbs]);

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const projects = projectsQuery.data ?? [];
  const agents = agentsQuery.data ?? [];
  const tree = useMemo(() => buildProjectTree(projects, agents), [agents, projects]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Network} message="Select an organization to view its project tree." />;
  }

  if (projectsQuery.isLoading || agentsQuery.isLoading) return <PageSkeleton variant="list" />;

  const error = projectsQuery.error ?? agentsQuery.error;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;

  if (tree.length === 0) {
    return (
      <EmptyState
        icon={Network}
        message="No project tree yet. Create a project for a subsystem or module and set its parent project."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Projects: {formatNumber(projects.filter((project) => !project.archivedAt).length)}</span>
        <span>Agents: {formatNumber(agents.length)}</span>
      </div>
      <div className="border border-border py-1">
        <div className="px-3 py-2 text-sm font-medium">{selectedCompany?.name ?? "Product line"}</div>
        <div className="ml-4 border-l border-border pl-2">
          {tree.map((node) => (
            <ProjectNode key={node.project.id} node={node} />
          ))}
        </div>
      </div>
    </div>
  );
}
