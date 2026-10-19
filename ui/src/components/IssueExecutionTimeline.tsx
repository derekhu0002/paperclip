import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Issue, WorkTimelineEvent, WorkTimelineSpan } from "@paperclipai/shared";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { workTimelineApi } from "../api/workTimeline";
import { createIssueDetailPath } from "../lib/issueDetailBreadcrumb";
import { formatDateTime, formatDurationMs } from "../lib/utils";
import type { ExecutionWindow } from "./IssuesList";
import { StatusIcon } from "./StatusIcon";

const WINDOW_MS: Record<ExecutionWindow, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const TICK_COUNT = 4;
const EXECUTION_STATUSES = new Set(["running", "succeeded", "completed", "failed", "timed_out", "cancelled"]);

type SegmentKind = "backlog" | "queue" | "execution" | "paused";

interface TaskSegment {
  kind: SegmentKind;
  left: number;
  width: number;
  durationMs: number;
}

interface TaskBar {
  issue: Issue;
  start: number;
  end: number;
  left: number;
  width: number;
  segments: TaskSegment[];
}

interface AgentGroup {
  key: string;
  name: string;
  tasks: TaskBar[];
}

interface IssueExecutionTimelineProps {
  companyId: string;
  issues: Issue[];
  issueIds: string[];
  timeWindow: ExecutionWindow;
  agents?: ReadonlyArray<{ id: string; name: string }>;
}

function segmentColor(kind: SegmentKind) {
  if (kind === "backlog") return "var(--status-task-backlog)";
  if (kind === "queue") return "var(--status-task-todo)";
  if (kind === "execution") return "var(--status-task-done)";
  return "var(--muted-foreground)";
}

function segmentLabel(kind: SegmentKind) {
  if (kind === "backlog") return "Backlog / blocked";
  if (kind === "queue") return "Queue";
  if (kind === "execution") return "Execution";
  return "Paused";
}

function actorLabel(actorById: ReadonlyMap<string, { name: string; type: string }>, actorId: string) {
  const actor = actorById.get(actorId);
  if (!actor) return actorId.slice(0, 8);
  if (actor.type === "user") return `Board / operator (${actor.name})`;
  return actor.name;
}

function formatTick(iso: string, timeWindow: ExecutionWindow) {
  const date = new Date(iso);
  if (timeWindow === "24h") {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function mergeIntervals(intervals: Array<{ start: number; end: number }>) {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function statusSegmentKind(status: string | null): SegmentKind {
  if (status === "backlog" || status === "blocked") return "backlog";
  if (status === "todo" || status === "in_progress") return "queue";
  return "paused";
}

function buildTaskBar(
  issue: Issue,
  spans: WorkTimelineSpan[],
  statusEvents: WorkTimelineEvent[],
  windowFrom: number,
  windowTo: number,
): TaskBar | null {
  const start = new Date(issue.createdAt).getTime();
  const terminal = issue.status === "done" || issue.status === "cancelled";
  const end = terminal ? new Date(issue.updatedAt).getTime() : windowTo;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || start > windowTo || end < windowFrom) {
    return null;
  }

  const visibleStart = Math.max(start, windowFrom);
  const visibleEnd = Math.min(end, windowTo);
  const total = Math.max(visibleEnd - visibleStart, 1);
  const executionIntervals = mergeIntervals(spans
    .filter((span) => EXECUTION_STATUSES.has(span.status))
    .map((span) => {
      const spanStart = Date.parse(span.start);
      const spanEnd = span.end ? Date.parse(span.end) : windowTo;
      return {
        start: Math.max(spanStart, visibleStart),
        end: Math.min(spanEnd, visibleEnd),
      };
    })
    .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start));

  const changes = statusEvents
    .filter((event) => event.issueId === issue.id && event.kind === "status_changed")
    .map((event) => ({ at: Date.parse(event.at), status: event.toStatus ?? null }))
    .filter((event) => Number.isFinite(event.at))
    .sort((left, right) => left.at - right.at);
  const beforeStart = changes.filter((event) => event.at <= visibleStart).pop();
  const firstAfter = changes.find((event) => event.at > visibleStart);
  const initialStatus = beforeStart?.status ?? firstAfter?.status ?? (changes.length > 0 ? null : "todo") ?? issue.status;
  const statusAt = (at: number) => {
    let status: string | null = initialStatus;
    for (const change of changes) {
      if (change.at > at) break;
      status = change.status;
    }
    return status;
  };

  const boundaries = new Set<number>([visibleStart, visibleEnd]);
  for (const change of changes) {
    if (change.at > visibleStart && change.at < visibleEnd) boundaries.add(change.at);
  }
  for (const interval of executionIntervals) {
    boundaries.add(interval.start);
    boundaries.add(interval.end);
  }
  const ordered = Array.from(boundaries).filter((value) => value >= visibleStart && value <= visibleEnd).sort((left, right) => left - right);
  const segments: TaskSegment[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const segmentStart = ordered[index]!;
    const segmentEnd = ordered[index + 1]!;
    if (segmentEnd <= segmentStart) continue;
    const executing = executionIntervals.some((interval) => interval.start < segmentEnd && interval.end > segmentStart);
    const status = statusAt(segmentStart);
    const hasExecutedBefore = executionIntervals.some((interval) => interval.end <= segmentStart);
    const kind = executing
      ? "execution"
      : status === "in_progress" && hasExecutedBefore
        ? "paused"
        : statusSegmentKind(status);
    segments.push({
      kind,
      left: ((segmentStart - visibleStart) / total) * 100,
      width: ((segmentEnd - segmentStart) / total) * 100,
      durationMs: segmentEnd - segmentStart,
    });
  }
  if (segments.length === 0) {
    segments.push({
      kind: "queue",
      left: 0,
      width: 100,
      durationMs: visibleEnd - visibleStart,
    });
  }

  return {
    issue,
    start,
    end,
    left: ((visibleStart - windowFrom) / Math.max(windowTo - windowFrom, 1)) * 100,
    width: Math.max(((visibleEnd - visibleStart) / Math.max(windowTo - windowFrom, 1)) * 100, 0.4),
    segments,
  };
}

function buildGroups(
  issues: Issue[],
  bars: TaskBar[],
  agentNames: Map<string, string>,
): AgentGroup[] {
  const barsByIssue = new Map(bars.map((bar) => [bar.issue.id, bar]));
  const groups = new Map<string, AgentGroup>();
  for (const issue of issues) {
    const bar = barsByIssue.get(issue.id);
    if (!bar) continue;
    const key = issue.assigneeAgentId ?? issue.assigneeUserId ?? "__unassigned__";
    const existing = groups.get(key) ?? {
      key,
      name: issue.assigneeAgentId
        ? agentNames.get(issue.assigneeAgentId) ?? `Agent ${issue.assigneeAgentId.slice(0, 8)}`
        : issue.assigneeUserId
          ? "Board / user"
          : "Unassigned",
      tasks: [],
    };
    existing.tasks.push(bar);
    groups.set(key, existing);
  }
  const result = Array.from(groups.values());
  for (const group of result) group.tasks.sort((left, right) => left.start - right.start);
  result.sort((left, right) => (left.tasks[0]?.start ?? 0) - (right.tasks[0]?.start ?? 0) || left.name.localeCompare(right.name));
  return result;
}

export function IssueExecutionTimeline({
  companyId,
  issues,
  issueIds,
  timeWindow,
  agents,
}: IssueExecutionTimelineProps) {
  const [anchor, setAnchor] = useState(() => Date.now());
  const [zoom, setZoom] = useState(1);
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

  const issueIdSet = useMemo(() => new Set(issueIds), [issueIdsKey]);
  const scopedData = useMemo(() => {
    if (!query.data) return null;
    return {
      ...query.data,
      spans: query.data.spans.filter((span) => issueIdSet.has(span.issueId)),
      events: query.data.events.filter((event) => issueIdSet.has(event.issueId)),
      edges: query.data.edges.filter((edge) => issueIdSet.has(edge.issueId)),
    };
  }, [issueIdSet, query.data]);

  const actorById = useMemo(
    () => new Map((scopedData?.actors ?? []).map((actor) => [actor.id, actor])),
    [scopedData?.actors],
  );
  const agentNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const agent of agents ?? []) names.set(agent.id, agent.name);
    for (const actor of scopedData?.actors ?? []) {
      if (actor.type === "agent") names.set(actor.id, actor.name);
    }
    return names;
  }, [agents, scopedData?.actors]);

  const windowFrom = scopedData ? Date.parse(scopedData.window.from) : from.getTime();
  const windowTo = scopedData ? Date.parse(scopedData.window.to) : to.getTime();
  const bars = useMemo(() => {
    if (!scopedData) return [];
    return issues.flatMap((issue) => {
      const spans = scopedData.spans.filter((span) => span.issueId === issue.id);
      const statusEvents = scopedData.events.filter((event) => event.issueId === issue.id);
      const bar = buildTaskBar(issue, spans, statusEvents, windowFrom, windowTo);
      return bar ? [bar] : [];
    });
  }, [issues, scopedData, windowFrom, windowTo]);
  const groups = useMemo(() => buildGroups(issues, bars, agentNames), [agentNames, bars, issues]);
  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, index) => {
    const ratio = index / TICK_COUNT;
    return {
      ratio,
      at: new Date(windowFrom + (windowTo - windowFrom) * ratio).toISOString(),
    };
  });
  const handoffs = useMemo(
    () => (scopedData?.edges ?? []).slice().sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime()),
    [scopedData?.edges],
  );
  const hasBoardSource = handoffs.some((edge) => actorById.get(edge.fromActorId)?.type === "user");
  const truncated = issues.length > issueIds.length;

  if (!enabled) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        No tasks match the current filters, so there is no execution view to show.
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

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        No tasks fall inside the last {timeWindow}. Switch the window or refine the filters.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm" style={{ backgroundColor: segmentColor("backlog") }} />
            Backlog / blocked
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm" style={{ backgroundColor: segmentColor("queue") }} />
            Queue
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm" style={{ backgroundColor: segmentColor("execution") }} />
            Execution
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm" style={{ backgroundColor: segmentColor("paused") }} />
            Paused / waiting
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>
            {groups.length} agent{groups.length === 1 ? "" : "s"} / {bars.length} task{bars.length === 1 ? "" : "s"} / last {timeWindow}
            {truncated ? ` / first ${issueIds.length} tasks` : ""}
          </span>
          <div className="flex items-center gap-1" role="group" aria-label="Timeline zoom">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => setZoom((current) => Math.max(1, current / 2))}
              disabled={zoom <= 1}
              aria-label="Zoom out timeline"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <span className="min-w-8 text-center text-xs tabular-nums">{zoom}x</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => setZoom((current) => Math.min(8, current * 2))}
              disabled={zoom >= 8}
              aria-label="Zoom in timeline"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <div className="min-w-0" style={{ width: `${zoom * 100}%` }}>
          <div className="flex border-b border-border">
            <div className="sticky left-0 z-20 flex w-48 shrink-0 items-end bg-card px-3 py-2 text-xs font-medium text-muted-foreground">
              Agent / task
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

          {groups.map((group) => (
            <div key={group.key}>
              <div className="flex border-b border-border bg-muted/30">
                <div className="sticky left-0 z-20 flex w-48 shrink-0 items-center gap-2 bg-muted/30 px-3 py-2">
                  <span className="truncate text-xs font-semibold">{group.name}</span>
                  <span className="shrink-0 text-(length:--text-nano) text-muted-foreground">{group.tasks.length}</span>
                </div>
                <div className="min-w-64 flex-1" />
              </div>
              {group.tasks.map((bar) => (
                <div key={bar.issue.id} className="flex h-14 border-b border-border/60 last:border-b-0 hover:bg-accent/30">
                  <div className="sticky left-0 z-20 flex w-48 shrink-0 items-center gap-2 bg-card px-3 py-2">
                    <StatusIcon status={bar.issue.status} size="sm" className="shrink-0" />
                    <div className="min-w-0">
                      <Link
                        to={createIssueDetailPath(bar.issue.id)}
                        className="block truncate text-xs font-medium hover:underline"
                      >
                        {bar.issue.identifier ?? bar.issue.id.slice(0, 8)}
                      </Link>
                      <div className="truncate text-(length:--text-nano) text-muted-foreground">{bar.issue.title}</div>
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
                    <Link
                      to={createIssueDetailPath(bar.issue.id)}
                      className="absolute top-1/2 flex h-6 -translate-y-1/2 overflow-hidden rounded-sm border border-border/70"
                      style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                      title={`${bar.issue.identifier ?? bar.issue.id.slice(0, 8)}: ${formatDateTime(bar.issue.createdAt)} to ${formatDateTime(bar.issue.updatedAt)}`}
                      aria-label={`${bar.issue.identifier ?? bar.issue.id.slice(0, 8)} task bar`}
                    >
                      {bar.segments.map((segment, index) => (
                        <span
                          key={`${segment.kind}:${index}`}
                          data-segment-kind={segment.kind}
                          className="absolute inset-y-0"
                          style={{
                            left: `${segment.left}%`,
                            width: `${segment.width}%`,
                            backgroundColor: segmentColor(segment.kind),
                          }}
                          title={`${segmentLabel(segment.kind)}: ${formatDurationMs(segment.durationMs)}`}
                        />
                      ))}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-3 py-2 text-xs font-medium">Handoffs / delegation</div>
        {hasBoardSource ? (
          <div className="border-b border-border/60 px-3 py-2 text-(length:--text-nano) text-muted-foreground">
            Assignment source is the task creator. Board/operator-created tasks show Board / operator to Agent; tasks created by manager or purple show Agent to Agent.
          </div>
        ) : null}
        {handoffs.length > 0 ? (
          <div>
            {handoffs.map((edge, index) => {
              const issue = issues.find((candidate) => candidate.id === edge.issueId);
              const source = actorLabel(actorById, edge.fromActorId);
              const target = actorLabel(actorById, edge.toActorId);
              return (
                <div key={`${edge.kind}:${edge.issueId}:${edge.at}:${index}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 px-3 py-2 text-xs last:border-b-0">
                  <span className="font-medium">{issue?.identifier ?? edge.issueId.slice(0, 8)}</span>
                  <span className="text-muted-foreground">{edge.kind === "delegation" ? "Delegation" : edge.kind === "assignment" ? "Assignment" : "Handoff"}</span>
                  <span>{source} to {target}</span>
                  <span className="ml-auto text-(length:--text-nano) text-muted-foreground">{formatDateTime(edge.at)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-3 py-2 text-xs text-muted-foreground">No delegation or assignment edges in this window.</div>
        )}
      </div>
    </div>
  );
}
