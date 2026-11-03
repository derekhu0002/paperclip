import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityLog, issueComments } from "@paperclipai/db";
import { conflict } from "../errors.js";
import { logActivity } from "./activity-log.js";

/**
 * Pre-write guard for agent-initiated `done` transitions, aligned with the
 * ArchGraph task-memory protocol v2:
 *
 * - The framework defines the protocol; the control plane enforces it.
 * - The agent writes one T2 memory element per finished task and ends its final
 *   summary with exactly one marker line:
 *     memory-capture: argo:<graphKey>#<elementId>
 *     memory-capture: none: <reason>   (explicit exemption)
 * - Missing marker: block with actionable feedback, at most twice. After that,
 *   allow the transition and record `memory-capture missed` for later review.
 * - No human escalation; the control plane validates the marker only, never the
 *   graph contents (no cross-device graph access).
 */
export const DONE_MEMORY_GATE_CODE = "task_memory_required";
export const MAX_MEMORY_GATE_BLOCKS = 2;

/** Comment line an agent leaves in its final summary. Prefix is case-sensitive. */
const MEMORY_MARKER_PATTERN =
  /(?:^|\n)[ \t]*(?:[-*][ \t]+)?memory-capture[ \t]*:[ \t]*(\S[^\n]*)/;

const GRAPH_REFERENCE_PATTERN = /^argo:(\S+)#(\S+)$/;
const EXEMPTION_PATTERN = /^none:[ \t]*(\S.*)$/i;

const MAX_COMMENTS_TO_SCAN = 100;

export type MemoryCaptureMarker =
  | { kind: "graph"; graphKey: string; elementId: string }
  | { kind: "exempt"; reason: string };

export function isDoneMemoryGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.PAPERCLIP_DONE_MEMORY_GATE?.trim().toLowerCase();
  return !(value === "off" || value === "0" || value === "false" || value === "disabled");
}

export function findMemoryCaptureMarker(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const match = MEMORY_MARKER_PATTERN.exec(text);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

export function parseMemoryCaptureMarker(
  value: string | null | undefined,
): MemoryCaptureMarker | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const graph = GRAPH_REFERENCE_PATTERN.exec(trimmed);
  if (graph) {
    return { kind: "graph", graphKey: graph[1], elementId: graph[2] };
  }
  const exemption = EXEMPTION_PATTERN.exec(trimmed);
  if (exemption) {
    return { kind: "exempt", reason: exemption[1].trim() };
  }
  return null;
}

export interface DoneMemoryGateInput {
  db: Db;
  issue: {
    id: string;
    companyId: string;
    identifier: string | null;
    status: string;
    assigneeAgentId: string | null;
  };
  actorAgentId?: string | null;
  actorRunId?: string | null;
  /** Comment body submitted in the same request (the PATCH `comment` field). */
  requestCommentBody?: string | null;
}

async function countGateBlocks(input: DoneMemoryGateInput): Promise<number> {
  const rows = await input.db
    .select({ count: sql<number>`count(*)::int` })
    .from(activityLog)
    .where(and(
      eq(activityLog.companyId, input.issue.companyId),
      eq(activityLog.entityType, "issue"),
      eq(activityLog.entityId, input.issue.id),
      eq(activityLog.action, "issue.memory_gate_blocked"),
    ));
  return Number(rows[0]?.count ?? 0);
}

async function findMarkerInComments(input: DoneMemoryGateInput): Promise<string | null> {
  const recentComments = await input.db
    .select({ body: issueComments.body })
    .from(issueComments)
    .where(and(
      eq(issueComments.issueId, input.issue.id),
      eq(issueComments.companyId, input.issue.companyId),
    ))
    .orderBy(desc(issueComments.createdAt))
    .limit(MAX_COMMENTS_TO_SCAN);

  for (const comment of recentComments) {
    const marker = findMemoryCaptureMarker(comment.body);
    if (marker) return marker;
  }
  return null;
}

async function logGateActivity(
  input: DoneMemoryGateInput,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  await logActivity(input.db, {
    companyId: input.issue.companyId,
    actorType: "system",
    actorId: "issue_memory_gate",
    agentId: input.actorAgentId ?? null,
    runId: input.actorRunId ?? null,
    action,
    entityType: "issue",
    entityId: input.issue.id,
    details,
  });
}

function feedbackTemplate(): Record<string, string> {
  return {
    written: "memory-capture: argo:<graphKey>#<elementId>",
    exempt: "memory-capture: none: <reason>",
  };
}

/**
 * Throws `409 task_memory_required` (at most twice per issue) when an agent
 * finishes a task without a valid task-memory marker. The second miss after the
 * cap is allowed and recorded as `memory-capture missed`.
 */
export async function assertAgentMemoryCaptureBeforeDone(
  input: DoneMemoryGateInput,
): Promise<void> {
  if (!isDoneMemoryGateEnabled()) return;
  if (!input.actorAgentId) return;
  if (!input.issue.assigneeAgentId) return;
  if (input.issue.status === "done") return;

  const requestMarker = findMemoryCaptureMarker(input.requestCommentBody);
  const marker = requestMarker ?? (await findMarkerInComments(input));
  const parsed = parseMemoryCaptureMarker(marker);

  if (parsed?.kind === "graph") return;

  if (parsed?.kind === "exempt") {
    await logGateActivity(input, "issue.memory_gate_exempted", {
      protocol: 2,
      reason: parsed.reason,
    });
    return;
  }

  const blocks = await countGateBlocks(input);
  const template = feedbackTemplate();

  if (blocks >= MAX_MEMORY_GATE_BLOCKS) {
    await logGateActivity(input, "issue.memory_gate_missed", {
      protocol: 2,
      blocks,
      marker: marker ?? null,
      ...template,
    });
    return;
  }

  const attempt = blocks + 1;
  await logGateActivity(input, "issue.memory_gate_blocked", {
    protocol: 2,
    attempt,
    maxAttempts: MAX_MEMORY_GATE_BLOCKS,
    marker: marker ?? null,
    ...template,
  });

  const label = input.issue.identifier ?? input.issue.id;
  throw conflict(
    `Task ${label} has no task memory capture. Write one T2 memory element to the project ARGO/ArchGraph graph, then end your final summary with exactly one line.`,
    {
      code: DONE_MEMORY_GATE_CODE,
      task: label,
      attempt,
      maxAttempts: MAX_MEMORY_GATE_BLOCKS,
      protocol: 2,
      accepts: template.written,
      exempt: template.exempt,
      content: [
        "result and evidence (changes/commit/files/verification)",
        "key decisions and rejected alternatives",
        "pitfalls and fixes (symptom -> cause -> fix)",
        "target T2 element id",
      ],
      remediation:
        "Write the T2 element with addArchitectureElement/updateArchitectureElement, then end your closing comment with exactly one line: memory-capture: argo:<graphKey>#<elementId> (or memory-capture: none: <reason> when you cannot write the graph).",
    },
  );
}
