import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Issue, WorkTimelineEvent, WorkTimelineResult, WorkTimelineSpan } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { workTimelineApi } from "../api/workTimeline";
import { createIssueDetailPath } from "../lib/issueDetailBreadcrumb";
import { formatDateTime, formatDurationMs, formatTokens } from "../lib/utils";
import type { ExecutionLane, ExecutionWindow } from "./IssuesList";
import { StatusIcon } from "./StatusIcon";

const WINDOW_MS: Record<ExecutionWindow, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const TICK_COUNT = 4;

interface IssueExecutionTimelineProps {
  companyId: string;
  issues: Issue[];
  issueIds: string[];
  lane: ExecutionLane;
  timeWindow: ExecutionWindow;
}

interface EdgePath {
  key: string;
  x: number;
  yFrom: number;
  yTo: number;
  color: string;
  title: string;
  dashed: boolean;
}

interface TimelineLane {
  key: string;
  title: string;
  subtitle: string;
  actorId?: string;
  issue?: Issue;
  spans: WorkTimelineSpan[];
  events: WorkTimelineEvent[];
  firstAt: number;
}

function statusColor(status: string) {
  switch (status) {
    case "succeeded":
    case "completed":
    case "done":
      return "var(--status-task-done)";
    case "failed":
    case "timed_out":
      return "var(--destructive)";
    case "running":
    case "in_progress":
      return "var(--status-task-in_progress)";
    case "queued":
    case "scheduled_retry":
      return "var(--status-task-todo)";
    case "cancelled":
      return "var(--muted-foreground)";
    default:
      return "var(--status-task-in_review)";
  }
}

function eventColor(kind: WorkTimelineEvent["kind"]) {
  switch (kind) {
    case "approved":
      return "var(--status-task-done)";
    case "commented":
      return "var(--muted-foreground)";
    case "assigned":
      return "var(--status-task-todo)";
    case "delegated":
      return "var(--status-task-in_progress)";
    default:
      return "var(--status-task-backlog)";
  }
}

function taskSpan(issue: Issue | undefined, windowFrom: number, windowTo: number) {
  if (!issue) return null;
  const start = new Date(issue.createdAt).getTime();
  const terminal = issue.status === "done" || issue.status === "cancelled";
  const end = terminal ? new Date(issue.updatedAt).getTime() : windowTo;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || start > windowTo) return null;
  const clampedStart = Math.max(start, windowFrom);
  const clampedEnd = Math.min(end, windowTo);
  const total = Math.max(windowTo - windowFrom, 1);
  return {
    left: ((clampedStart - windowFrom) / total) * 100,
    width: Math.max(((clampedEnd - clampedStart) / total) * 100, 0.4),
    durationMs: Math.max(end - start, 0),
  };
}

function clampPercent(timestamp: number, windowFrom: number, windowTo: number) {
  const total = Math.max(windowTo - windowFrom, 1);
  return Math.min(100, Math.max(0, ((timestamp - windowFrom) / total) * 100));
}

function eventLabel(kind: WorkTimelineEvent["kind"]) {
  switch (kind) {
    case "approved":
      return "Approved";
    case "commented":
      return "Commented";
    case "assigned":
      return "Assigned";
    case "delegated":
      return "Delegated";
    default:
      return "Created";
  }
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCost(costUsd: number | null | undefined) {
  if (costUsd == null) return "Cost n/a";
  return costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(2)}`;
}

function formatTick(iso: string, timeWindow: ExecutionWindow) {
  const date = new Date(iso);
  if (timeWindow === "24h") {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function buildTaskLanes(result: WorkTimelineResult, issuesById: Map<string, Issue>) {
  const lanes = new Map<string, TimelineLane>();

  for (const span of result.spans) {
    const existing = lanes.get(span.issueId) ?? {
      key: `issue:${span.issueId}`,
      title: span.issueIdentifier ?? span.issueId.slice(0, 8),
      subtitle: span.issueTitle ?? "Task",
      issue: issuesById.get(span.issueId),
      spans: [],
      events: [],
      firstAt: Number.POSITIVE_INFINITY,
    };
    existing.spans.push(span);
    existing.firstAt = Math.min(existing.firstAt, Date.parse(span.start));
    if (!existing.issue) existing.issue = issuesById.get(span.issueId);
    lanes.set(span.issueId, existing);
  }

  for (const event of result.events) {
    const issue = issuesById.get(event.issueId);
    const existing = lanes.get(event.issueId) ?? {
      key: `issue:${event.issueId}`,
      title: issue?.identifier ?? event.issueId.slice(0, 8),
      subtitle: issue?.title ?? "Task",
      issue,
      spans: [],
      events: [],
      firstAt: Number.POSITIVE_INFINITY,
    };
    existing.events.push(event);
    existing.firstAt = Math.min(existing.firstAt, Date.parse(event.at));
    if (!existing.issue) existing.issue = issue;
    lanes.set(event.issueId, existing);
  }

  return Array.from(lanes.values()).sort((left, right) => left.firstAt - right.firstAt);
}

function buildAgentLanes(result: WorkTimelineResult) {
  const lanes = new Map<string, TimelineLane>();
  const actorById = new Map(result.actors.map((actor) => [actor.id, actor]));

  for (const span of result.spans) {
    const actor = actorById.get(span.actorId);
    if (!actor || actor.type !== "agent") continue;
    const existing = lanes.get(span.actorId) ?? {
      key: `agent:${span.actorId}`,
      title: actor.name,
      subtitle: "Agent",
      actorId: span.actorId,
      spans: [],
      events: [],
      firstAt: Number.POSITIVE_INFINITY,
    };
    existing.spans.push(span);
    existing.firstAt = Math.min(existing.firstAt, Date.parse(span.start));
    lanes.set(span.actorId, existing);
  }

  for (const event of result.events) {
    const actor = actorById.get(event.actorId);
    if (!actor || actor.type !== "agent") continue;
    const existing = lanes.get(event.actorId) ?? {
      key: `agent:${event.actorId}`,
      title: actor.name,
      subtitle: "Agent",
      actorId: event.actorId,
      spans: [],
      events: [],
      firstAt: Number.POSITIVE_INFINITY,
    };
    existing.events.push(event);
    existing.firstAt = Math.min(existing.firstAt, Date.parse(event.at));
    lanes.set(event.actorId, existing);
  }

  return Array.from(lanes.values()).sort((left, right) => left.firstAt - right.firstAt);
}

function RunBar({
  span,
  windowFrom,
  windowTo,
  actorName,
}: {
  span: WorkTimelineSpan;
  windowFrom: number;
  windowTo: number;
  actorName: string;
}) {
  const total = Math.max(windowTo - windowFrom, 1);
  const rawStart = Date.parse(span.start);
  const rawEnd = span.end ? Date.parse(span.end) : windowTo;
  const start = Math.min(Math.max(rawStart, windowFrom), windowTo);
  const end = Math.min(Math.max(rawEnd, start), windowTo);
  const left = ((start - windowFrom) / total) * 100;
  const width = Math.min(Math.max(((end - start) / total) * 100, 0.4), 100 - left);
  const durationMs = Math.max(end - start, 0);
  const usage = span.usage;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={createIssueDetailPath(span.issueId)}
          className="absolute top-1/2 h-2 min-w-1 -translate-y-1/2 rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            left: `${left}%`,
            width: `${width}%`,
            backgroundColor: statusColor(span.status),
          }}
          aria-label={`${span.issueIdentifier ?? span.issueId}: ${statusLabel(span.status)} run by ${actorName}, ${formatDurationMs(durationMs)}`}
        />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        <div className="space-y-1">
          <div className="font-medium">
            {span.issueIdentifier ?? span.issueId.slice(0, 8)} / {statusLabel(span.status)}
          </div>
          <div className="text-muted-foreground">{actorName}</div>
          <div>
            {formatDateTime(span.start)} to {span.end ? formatDateTime(span.end) : "running"}
          </div>
          <div>Duration: {formatDurationMs(durationMs)}</div>
          <div>
            {usage ? `${formatTokens(usage.totalTokens)} tokens` : "Tokens n/a"}
            {" / "}
            {formatCost(span.costUsd)}
          </div>
          {span.invocationSource ? <div>Wake: {span.invocationSource}</div> : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function EventMarker({
  event,
  windowFrom,
  windowTo,
  actorName,
}: {
  event: WorkTimelineEvent;
  windowFrom: number;
  windowTo: number;
  actorName: string;
}) {
  const total = Math.max(windowTo - windowFrom, 1);
  const at = Math.min(Math.max(Date.parse(event.at), windowFrom), windowTo);
  const left = ((at - windowFrom) / total) * 100;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="img"
          className="absolute top-1/2 z-10 h-2 w-2 -translate-y-1/2 rounded-full border border-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ left: `${left}%`, backgroundColor: eventColor(event.kind) }}
          aria-label={`${eventLabel(event.kind)} by ${actorName} at ${formatDateTime(event.at)}`}
        />
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="font-medium">{eventLabel(event.kind)}</div>
        <div className="text-muted-foreground">{actorName}</div>
        <div>{formatDateTime(event.at)}</div>
      </TooltipContent>
    </Tooltip>
  );
}

export function IssueExecutionTimeline({
  companyId,
  issues,
  issueIds,
  lane,
  timeWindow,
}: IssueExecutionTimelineProps) {
  const [anchor, setAnchor] = useState(() => Date.now());
  useEffect(() => {
    const timer = globalThis.setInterval(() => setAnchor(Date.now()), 60_000);
    return () => globalThis.clearInterval(timer);
  }, []);

  const issueIdsKey = issueIds.join(",");
  const from = new Date(anchor - WINDOW_MS[timeWindow]);
  const to = new Date(anchor);
  const enabled = Boolean(companyId && issueIds.length > 0);
  const query = useQuery({
    queryKey: ["issue-execution-timeline", companyId, issueIdsKey, timeWindow, Math.floor(anchor / 60_000)],
    queryFn: () => workTimelineApi.get(companyId, {
      from: from.toISOString(),
      to: to.toISOString(),
      issueIds,
      limit: 200,
    }),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
    staleTime: 5_000,
  });

  const issuesById = useMemo(() => new Map(issues.map((issue) => [issue.id, issue])), [issues]);
  const actorById = useMemo(
    () => new Map((query.data?.actors ?? []).map((actor) => [actor.id, actor])),
    [query.data?.actors],
  );
  const lanes = useMemo(() => {
    if (!query.data) return [];
    return lane === "agent" ? buildAgentLanes(query.data) : buildTaskLanes(query.data, issuesById);
  }, [lane, query.data, issuesById]);

  const windowFrom = query.data ? Date.parse(query.data.window.from) : from.getTime();
  const windowTo = query.data ? Date.parse(query.data.window.to) : to.getTime();
  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, index) => {
    const ratio = index / TICK_COUNT;
    return {
      ratio,
      at: new Date(windowFrom + (windowTo - windowFrom) * ratio).toISOString(),
    };
  });
  const edgePaths = useMemo<EdgePath[]>(() => {
    if (!query.data || lanes.length === 0) return [];
    const issueLane = new Map(lanes.flatMap((row, index) => row.issue ? [[row.issue.id, index] as const] : []));
    const actorLane = new Map(lanes.flatMap((row, index) => row.actorId ? [[row.actorId, index] as const] : []));
    return query.data.edges.flatMap((edge, index) => {
      let fromIndex: number | undefined;
      let toIndex: number | undefined;
      if (lane === "agent") {
        fromIndex = actorLane.get(edge.fromActorId);
        toIndex = actorLane.get(edge.toActorId);
      } else {
        toIndex = issueLane.get(edge.issueId);
        const issue = issuesById.get(edge.issueId);
        const parentId = issue?.parentId;
        if (edge.kind === "delegation" && parentId) fromIndex = issueLane.get(parentId);
      }
      if (toIndex === undefined) return [];
      const yTo = ((toIndex + 0.5) / lanes.length) * 100;
      const yFrom = fromIndex === undefined ? yTo : ((fromIndex + 0.5) / lanes.length) * 100;
      const source = actorById.get(edge.fromActorId)?.name ?? edge.fromActorId.slice(0, 8);
      const target = actorById.get(edge.toActorId)?.name ?? edge.toActorId.slice(0, 8);
      const label = edge.kind === "delegation" ? "Delegation" : edge.kind === "assignment" ? "Assignment" : "Handoff";
      return [{
        key: `${edge.kind}:${edge.issueId}:${edge.at}:${index}`,
        x: clampPercent(Date.parse(edge.at), windowFrom, windowTo),
        yFrom,
        yTo,
        color: edge.kind === "delegation" ? "var(--status-task-in_progress)" : "var(--status-task-todo)",
        title: `${label}: ${source} to ${target}`,
        dashed: edge.kind === "assignment",
      }];
    });
  }, [actorById, issuesById, lane, lanes, query.data, windowFrom, windowTo]);
  const truncated = issues.length > issueIds.length;

  if (!enabled) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        No tasks match the current filters, so there is no execution window to show.
      </div>
    );
  }

  if (query.isPending) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground" role="status">
        Loading execution timeline...
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-card p-6 text-sm text-destructive">
        Failed to load execution timeline.{" "}
        <button type="button" className="underline underline-offset-2" onClick={() => void query.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  if (lanes.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        No runs or task events in the last {timeWindow}. Switch the window or refine the filters to see execution activity.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {(["succeeded", "running", "queued", "failed", "cancelled"] as const).map((status) => (
            <span key={status} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusColor(status) }} />
              {statusLabel(status)}
            </span>
          ))}
          {lane === "task" ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-sm border border-border/50 bg-muted-foreground/20" />
              Task span
            </span>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-4" style={{ backgroundColor: "var(--status-task-in_progress)" }} />
                Delegation
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-4 border-t border-dashed" style={{ borderColor: "var(--status-task-todo)" }} />
                Assignment
              </span>
            </>
          )}
        </div>
        <span>
          {query.data?.spans.length ?? 0} runs / last {timeWindow}
          {truncated ? ` / first ${issueIds.length} tasks` : ""}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <div className="w-full min-w-0">
          <div className="flex border-b border-border">
            <div className="flex w-48 shrink-0 items-end px-3 py-2 text-xs font-medium text-muted-foreground">
              {lane === "agent" ? "Agent" : "Task"}
            </div>
            <div className="relative min-w-64 flex-1 py-2">
              {ticks.map((tick) => (
                <span
                  key={tick.ratio}
                  className="absolute top-0 -translate-x-1/2 text-(length:--text-nano) text-muted-foreground"
                  style={{ left: `${tick.ratio * 100}%` }}
                >
                  {formatTick(tick.at, timeWindow)}
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            {lanes.map((laneRow) => {
              const taskBar = laneRow.issue ? taskSpan(laneRow.issue, windowFrom, windowTo) : null;
              return (
                <div key={laneRow.key} className="flex h-12 border-b border-border/60 last:border-b-0">
                  <div className="flex w-48 shrink-0 items-center gap-2 px-3 py-2">
                    {laneRow.issue ? (
                      <StatusIcon status={laneRow.issue.status} size="sm" className="shrink-0" />
                    ) : (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">{laneRow.title}</div>
                      <div className="truncate text-(length:--text-nano) text-muted-foreground">{laneRow.subtitle}</div>
                    </div>
                  </div>
                  <div className="relative min-w-64 flex-1">
                    {ticks.map((tick) => (
                      <span
                        key={tick.ratio}
                        className="pointer-events-none absolute inset-y-0 border-l border-border/50"
                        style={{ left: `${tick.ratio * 100}%` }}
                        aria-hidden="true"
                      />
                    ))}
                    {taskBar ? (
                      <div
                        className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm border border-border/50 bg-muted-foreground/20"
                        style={{ left: `${taskBar.left}%`, width: `${taskBar.width}%` }}
                        title={`${laneRow.title}: open ${formatDurationMs(taskBar.durationMs)}`}
                        aria-label={`Task span ${formatDurationMs(taskBar.durationMs)}`}
                      />
                    ) : null}
                    {laneRow.events.map((event, index) => (
                      <EventMarker
                        key={`${event.kind}:${event.issueId}:${event.at}:${index}`}
                        event={event}
                        windowFrom={windowFrom}
                        windowTo={windowTo}
                        actorName={actorById.get(event.actorId)?.name ?? event.actorId}
                      />
                    ))}
                    {laneRow.spans.map((span) => (
                      <RunBar
                        key={span.runId}
                        span={span}
                        windowFrom={windowFrom}
                        windowTo={windowTo}
                        actorName={actorById.get(span.actorId)?.name ?? span.actorId}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            {edgePaths.length > 0 ? (
              <div className="pointer-events-none absolute inset-y-0 left-48 right-0">
                <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {edgePaths.map((edge) => (
                    <g key={edge.key}>
                      <title>{edge.title}</title>
                      <path
                        d={`M ${edge.x} ${edge.yFrom} L ${edge.x} ${edge.yTo}`}
                        fill="none"
                        stroke={edge.color}
                        strokeWidth={0.8}
                        strokeDasharray={edge.dashed ? "2 2" : undefined}
                        vectorEffect="non-scaling-stroke"
                        opacity={0.75}
                      />
                      <circle cx={edge.x} cy={edge.yTo} r={1.2} fill={edge.color} />
                    </g>
                  ))}
                </svg>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
