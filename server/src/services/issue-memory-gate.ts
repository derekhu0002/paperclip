import { and, desc, eq } from "drizzle-orm";
import { issueComments } from "@paperclipai/db";
import { conflict } from "../errors.js";

/**
 * Pre-write guard for agent-initiated `done` transitions.
 *
 * The agent marks a task done while its run is still alive. Rejecting that
 * write keeps it inside the same conversation, so it can write the memory
 * element and retry immediately. Rejecting here also means no dependency
 * release, workspace finalization, or activity side effects happen first.
 */
export const DONE_MEMORY_GATE_CODE = "task_memory_required";

/** Comment line an agent leaves after writing a graph element. */
const MEMORY_MARKER_PATTERN =
  /(?:^|\n)[ \t]*(?:[-*][ \t]+)?memory-capture[ \t]*:[ \t]*(\S[^\n]*)/i;

/** The reference must name a graph and an element: `argo:<graphKey>#<elementId>`. */
const GRAPH_MEMORY_REFERENCE_PATTERN = /^argo:\S+#\S+$/;

const MAX_COMMENTS_TO_SCAN = 100;

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

export function isGraphMemoryReference(value: string | null | undefined): boolean {
  return typeof value === "string" && GRAPH_MEMORY_REFERENCE_PATTERN.test(value.trim());
}

export interface DoneMemoryGateInput {
  db: {
    select: (...args: any[]) => any;
  };
  issue: {
    id: string;
    companyId: string;
    identifier: string | null;
    status: string;
    assigneeAgentId: string | null;
  };
  actorAgentId?: string | null;
  /** Comment body submitted in the same request (the PATCH `comment` field). */
  requestCommentBody?: string | null;
}

/**
 * Throws a `409 task_memory_required` when an agent tries to finish a task
 * without a graph memory reference in this request or an earlier comment.
 */
export async function assertAgentMemoryCaptureBeforeDone(
  input: DoneMemoryGateInput,
): Promise<void> {
  if (!isDoneMemoryGateEnabled()) return;
  if (!input.actorAgentId) return;
  if (!input.issue.assigneeAgentId) return;
  if (input.issue.status === "done") return;

  if (isGraphMemoryReference(findMemoryCaptureMarker(input.requestCommentBody))) {
    return;
  }

  const recentComments = await input.db
    .select({ body: issueComments.body })
    .from(issueComments)
    .where(and(
      eq(issueComments.issueId, input.issue.id),
      eq(issueComments.companyId, input.issue.companyId),
    ))
    .orderBy(desc(issueComments.createdAt))
    .limit(MAX_COMMENTS_TO_SCAN) as Array<{ body: string | null }>;

  for (const comment of recentComments) {
    if (isGraphMemoryReference(findMemoryCaptureMarker(comment.body))) return;
  }

  const label = input.issue.identifier ?? input.issue.id;
  throw conflict(
    `Task ${label} has no graph memory capture. Write the lessons, key decisions, and pitfalls to the project ARGO/ArchGraph memory graph, then retry with a memory reference.`,
    {
      code: DONE_MEMORY_GATE_CODE,
      task: label,
      accepts: "memory-capture: argo:<graphKey>#<elementId>",
      remediation:
        "Use addArchitectureElement/updateArchitectureElement on the project graph and add a comment line: memory-capture: argo:<graphKey>#<elementId>",
    },
  );
}
