import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Agent, HeartbeatRunEvent, Issue } from "@paperclipai/shared";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { activityApi, type RunForIssue } from "../api/activity";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { extractIssueTimelineEvents, type IssueTimelineEvent } from "../lib/issue-timeline-events";
import { formatDateTime, formatDurationMs, formatTokens } from "../lib/utils";

type UserLabelMap = ReadonlyMap<string, { label: string }>;

interface IssueExecutionPanelProps {
  issue: Issue;
  agentMap: ReadonlyMap<string, Agent>;
  userProfileMap?: UserLabelMap;
  currentUserId?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function runTokens(run: RunForIssue) {
  const usage = asRecord(run.usageJson);
  if (!usage) return 0;
  const input = readNumber(usage.inputTokens) ?? readNumber(usage.input_tokens) ?? 0;
  const output = readNumber(usage.outputTokens) ?? readNumber(usage.output_tokens) ?? 0;
  const cached = readNumber(usage.cachedInputTokens) ?? readNumber(usage.cached_input_tokens) ?? 0;
  return Math.max(0, input) + Math.max(0, output) + Math.max(0, cached);
}

function runCost(run: RunForIssue) {
  for (const source of [asRecord(run.resultJson), asRecord(run.usageJson)]) {
    if (!source) continue;
    for (const key of ["costUsd", "cost_usd", "total_cost_usd", "costUsdExact", "cacheAdjustedCostUsd"]) {
      const value = readNumber(source[key]);
      if (value != null) return Math.max(0, value);
    }
  }
  return 0;
}

function runStatusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function runStatusColor(status: string) {
  switch (status) {
    case "succeeded":
    case "completed":
      return "var(--status-task-done)";
    case "failed":
    case "timed_out":
      return "var(--destructive)";
    case "running":
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

function isSuccess(status: string) {
  return status === "succeeded" || status === "completed";
}

function isLive(status: string) {
  return status === "running" || status === "queued" || status === "scheduled_retry";
}

function formatCost(costUsd: number) {
  if (costUsd <= 0) return "Cost n/a";
  return costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(2)}`;
}

function eventLabel(event: IssueTimelineEvent) {
  if (event.statusChange) {
    return `Status ${event.statusChange.from ?? "unknown"} to ${event.statusChange.to ?? "unknown"}`;
  }
  if (event.assigneeChange) return "Assignee changed";
  if (event.workspaceChange) return "Execution workspace changed";
  if (event.followUpRequested) return "Follow-up requested";
  return "Task updated";
}

function eventTone(event: IssueTimelineEvent) {
  if (event.statusChange?.to === "done") return "var(--status-task-done)";
  if (event.statusChange?.to === "blocked") return "var(--destructive)";
  if (event.assigneeChange) return "var(--status-task-todo)";
  return "var(--muted-foreground)";
}

function runEventsLabel(event: HeartbeatRunEvent) {
  return event.message || event.eventType;
}

export function IssueExecutionPanel({
  issue,
  agentMap,
  userProfileMap,
  currentUserId,
}: IssueExecutionPanelProps) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const activityQuery = useQuery({
    queryKey: queryKeys.issues.activity(issue.id),
    queryFn: () => activityApi.forIssue(issue.id),
    refetchInterval: 10_000,
  });
  const runsQuery = useQuery({
    queryKey: queryKeys.issues.runs(issue.id),
    queryFn: () => activityApi.runsForIssue(issue.id),
    refetchInterval: 5_000,
  });
  const eventsQuery = useQuery({
    queryKey: ["heartbeat-run", expandedRunId ?? "__none__", "events"],
    queryFn: () => heartbeatsApi.events(expandedRunId!, 0, 100),
    enabled: Boolean(expandedRunId),
  });

  const runs = useMemo(
    () => [...(runsQuery.data ?? [])].sort((left, right) => {
      const leftAt = new Date(left.startedAt ?? left.createdAt).getTime();
      const rightAt = new Date(right.startedAt ?? right.createdAt).getTime();
      return rightAt - leftAt;
    }),
    [runsQuery.data],
  );
  const activity = activityQuery.data ?? [];
  const hasLive = runs.some((run) => isLive(run.status));

  const summary = useMemo(() => {
    let runtimeMs = 0;
    let tokens = 0;
    let cost = 0;
    let succeeded = 0;
    let failed = 0;
    const now = Date.now();
    for (const run of runs) {
      tokens += runTokens(run);
      cost += runCost(run);
      if (isSuccess(run.status)) succeeded += 1;
      if (run.status === "failed" || run.status === "timed_out") failed += 1;
      if (run.startedAt) {
        const start = new Date(run.startedAt).getTime();
        const end = run.finishedAt ? new Date(run.finishedAt).getTime() : now;
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) runtimeMs += end - start;
      }
    }
    return { runtimeMs, tokens, cost, succeeded, failed };
  }, [runs]);

  const timelineEvents = useMemo(() => {
    return extractIssueTimelineEvents(activity)
      .filter((event) => event.statusChange || event.assigneeChange || event.workspaceChange || event.followUpRequested)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 50);
  }, [activity]);

  const actorLabel = (agentId: string | null | undefined, userId: string | null | undefined) => {
    if (agentId) return agentMap.get(agentId)?.name ?? agentId.slice(0, 8);
    if (userId) {
      if (userId === currentUserId) return "You";
      return userProfileMap?.get(userId)?.label ?? userId.slice(0, 8);
    }
    return "System";
  };

  const runAgentLabel = (run: RunForIssue) => actorLabel(run.agentId, null);

  if (activityQuery.isPending && runsQuery.isPending) {
    return <div className="text-sm text-muted-foreground" role="status">Loading execution record...</div>;
  }

  if (activityQuery.isError || runsQuery.isError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
        Failed to load execution record.{" "}
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => {
            void activityQuery.refetch();
            void runsQuery.refetch();
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Runs", String(runs.length)],
          ["Succeeded", String(summary.succeeded)],
          ["Failed", String(summary.failed)],
          ["Runtime", summary.runtimeMs > 0 ? formatDurationMs(summary.runtimeMs) : "n/a"],
          ["Tokens", summary.tokens > 0 ? formatTokens(summary.tokens) : "n/a"],
          ["Cost", formatCost(summary.cost)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-card px-3 py-2">
            <div className="text-(length:--text-nano) uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="text-sm font-medium tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Runs</h3>
          {hasLive ? <span className="text-(length:--text-nano) text-muted-foreground">Live 路 updates every 5s</span> : null}
        </div>
        {runs.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            No runs recorded for this task yet.
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => {
              const expanded = expandedRunId === run.runId;
              const durationMs = run.startedAt
                ? Math.max(0, (run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now()) - new Date(run.startedAt).getTime())
                : 0;
              return (
                <div key={run.runId} className="overflow-hidden rounded-lg border border-border bg-card">
                  <div className="flex items-start gap-3 p-3">
                    <span
                      className="mt-1 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: runStatusColor(run.status) }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{runStatusLabel(run.status)}</span>
                        <Badge variant="outline" className="text-(length:--text-nano)">{run.invocationSource}</Badge>
                        {run.retryOfRunId ? <Badge variant="outline" className="text-(length:--text-nano)">Retry</Badge> : null}
                        {run.continuationAttempt ? <Badge variant="outline" className="text-(length:--text-nano)">Continuation {run.continuationAttempt}</Badge> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {runAgentLabel(run)}
                        {run.startedAt ? ` 路 ${formatDateTime(run.startedAt)}` : ""}
                        {run.finishedAt ? ` to ${formatDateTime(run.finishedAt)}` : run.startedAt ? " to running" : ""}
                        {durationMs > 0 ? ` 路 ${formatDurationMs(durationMs)}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {runTokens(run) > 0 ? `${formatTokens(runTokens(run))} tokens` : "Tokens n/a"}
                        {" / "}
                        {formatCost(runCost(run))}
                      </div>
                      {run.error ? <div className="break-words text-xs text-destructive">{run.error}</div> : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 gap-1 px-2 text-xs"
                      onClick={() => setExpandedRunId(expanded ? null : run.runId)}
                      aria-expanded={expanded}
                    >
                      {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      Events
                    </Button>
                  </div>
                  {expanded ? (
                    <div className="border-t border-border bg-muted/20 px-3 py-2">
                      {eventsQuery.isPending ? (
                        <div className="text-xs text-muted-foreground">Loading run events...</div>
                      ) : eventsQuery.data && eventsQuery.data.length > 0 ? (
                        <div className="max-h-64 space-y-1 overflow-y-auto">
                          {eventsQuery.data.map((event) => (
                            <div key={event.id} className="flex gap-2 text-xs">
                              <span className="w-32 shrink-0 tabular-nums text-muted-foreground">{formatDateTime(event.createdAt)}</span>
                              <span className="shrink-0 font-medium">{event.eventType}</span>
                              <span className="min-w-0 break-words text-muted-foreground">{runEventsLabel(event)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">No run events recorded.</div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Status and handoffs</h3>
        {timelineEvents.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            No status, assignment, or handoff changes recorded.
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card">
            {timelineEvents.map((event) => (
              <div key={event.id} className="flex items-start gap-3 border-b border-border/60 px-3 py-2 last:border-b-0">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: eventTone(event) }}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{eventLabel(event)}</div>
                  <div className="text-(length:--text-nano) text-muted-foreground">
                    {actorLabel(
                      event.actorType === "agent" ? event.actorId : null,
                      event.actorType === "user" ? event.actorId : null,
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-(length:--text-nano) text-muted-foreground">
                  {formatDateTime(event.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
