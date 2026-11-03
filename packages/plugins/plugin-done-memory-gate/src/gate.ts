import type { Issue, PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import {
  CONTRACT_COMMENT_PREFIX,
  MAX_GATE_ATTEMPTS,
  MEMORY_CAPTURE_SKILL_KEY,
  MEMORY_DOCUMENT_KEY,
  STATE_KEY_ATTEMPTS,
  STATE_KEY_EXHAUSTED_NOTIFIED,
  STATE_NAMESPACE,
} from "./constants.js";
import { isDoneTransition, isPluginOperationIssue } from "./done-transition.js";
import {
  findMemoryEvidence,
  type MemoryEvidence,
} from "./memory-evidence.js";

export type GateOutcome =
  | { action: "ignored"; reason: string }
  | { action: "passed"; evidence: MemoryEvidence }
  | { action: "reverted"; attempts: number }
  | { action: "soft-reminder"; dependents: number }
  | { action: "attempt-cap"; notified: boolean };

function attemptKey(issueId: string) {
  return {
    scopeKind: "issue" as const,
    scopeId: issueId,
    namespace: STATE_NAMESPACE,
    stateKey: STATE_KEY_ATTEMPTS,
  };
}

function exhaustedKey(issueId: string) {
  return {
    scopeKind: "issue" as const,
    scopeId: issueId,
    namespace: STATE_NAMESPACE,
    stateKey: STATE_KEY_EXHAUSTED_NOTIFIED,
  };
}

function readAttempts(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function issueLabel(issue: Issue): string {
  return issue.identifier ?? issue.id;
}

function contractBody(issue: Issue, attemptsLeft: number, documentFallback: boolean): string {
  return [
    `${CONTRACT_COMMENT_PREFIX} This task was marked \`done\` without a memory element in the knowledge graph, so it is back in \`in_progress\`.`,
    "",
    "Write the lessons, key decisions, and pitfalls into the project's ARGO/ArchGraph memory graph before marking it done again:",
    "",
    "1. Use the ARGO/ArchGraph MCP tools (`addArchitectureElement` or `updateArchitectureElement`) to write a Tier 2 memory element.",
    "2. Leave one closing-comment line naming the element: `memory-capture: argo:<graphKey>#<elementId>`.",
    ...(documentFallback
      ? ["", `Operator fallback is enabled: a \`${MEMORY_DOCUMENT_KEY}\` issue document with 200+ characters also satisfies the gate.`]
      : []),
    "",
    `The plugin-managed skill \`${MEMORY_CAPTURE_SKILL_KEY}\` describes the full contract. Gate attempts left for ${issueLabel(issue)}: ${attemptsLeft}.`,
  ].join("\n");
}

function softReminderBody(dependents: number): string {
  return [
    `${CONTRACT_COMMENT_PREFIX} This task is staying \`done\` because ${dependents} dependent task(s) already depend on it, and reverting it could release them prematurely.`,
    "",
    "The graph memory capture is still missing. For the next task, write the lessons, key decisions, and pitfalls into the project's ARGO/ArchGraph memory graph before marking it done.",
    "Then add one closing-comment line: `memory-capture: argo:<graphKey>#<elementId>`.",
  ].join("\n");
}

function exhaustedBody(): string {
  return [
    `${CONTRACT_COMMENT_PREFIX} Graph memory capture is still missing, but this task reached the gate attempt cap.`,
    "",
    "Marking it `done` anyway to avoid a done/revert loop. Write the memory element into the project graph and add a `memory-capture: argo:<graphKey>#<elementId>` comment when you can.",
  ].join("\n");
}

async function collectEvidence(
  ctx: PluginContext,
  issue: Issue,
  allowIssueDocumentFallback: boolean,
): Promise<MemoryEvidence | null> {
  const comments = await ctx.issues.listComments(issue.id, issue.companyId);
  const document = allowIssueDocumentFallback
    ? await ctx.issues.documents.get(issue.id, MEMORY_DOCUMENT_KEY, issue.companyId)
    : null;
  return findMemoryEvidence({
    // The gate's own reminder comments quote the marker; never treat them as proof.
    commentBodies: comments
      .map((comment) => comment.body)
      .filter((body) => !body?.includes(CONTRACT_COMMENT_PREFIX)),
    memoryDocumentBody: document?.body,
    allowIssueDocumentFallback,
  });
}

async function ensureCaptureSkill(ctx: PluginContext, companyId: string): Promise<void> {
  try {
    await ctx.skills.managed.reconcile(MEMORY_CAPTURE_SKILL_KEY, companyId);
  } catch (error) {
    ctx.logger.warn("done-memory-gate could not reconcile its managed skill", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readDocumentFallbackConfig(
  ctx: PluginContext,
  companyId: string,
): Promise<boolean> {
  try {
    const config = await ctx.config.get(companyId);
    return config?.allowIssueDocumentFallback === true;
  } catch (error) {
    ctx.logger.warn("done-memory-gate could not read its config; using strict graph mode", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function handleIssueUpdated(
  ctx: PluginContext,
  event: PluginEvent,
): Promise<GateOutcome> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  if (event.eventType !== "issue.updated") {
    return { action: "ignored", reason: "not an issue update" };
  }
  if (!isDoneTransition(payload)) {
    return { action: "ignored", reason: "not a done transition" };
  }
  if (event.actorType !== "agent") {
    return { action: "ignored", reason: "not an agent-initiated done" };
  }

  const companyId = event.companyId;
  const issueId = event.entityId
    ?? (typeof payload.issueId === "string" ? payload.issueId : "");
  if (!issueId) return { action: "ignored", reason: "missing issue id" };

  const issue = await ctx.issues.get(issueId, companyId);
  if (!issue || issue.status !== "done") {
    return { action: "ignored", reason: "issue is not done" };
  }
  if (!issue.assigneeAgentId) {
    return { action: "ignored", reason: "issue has no agent assignee" };
  }
  if (isPluginOperationIssue(issue.originKind)) {
    return { action: "ignored", reason: "plugin operation issue" };
  }

  const allowIssueDocumentFallback = await readDocumentFallbackConfig(ctx, companyId);

  const evidence = await collectEvidence(ctx, issue, allowIssueDocumentFallback);
  if (evidence) return { action: "passed", evidence };

  const attempts = readAttempts(await ctx.state.get(attemptKey(issue.id)));
  if (attempts >= MAX_GATE_ATTEMPTS) {
    const alreadyNotified = (await ctx.state.get(exhaustedKey(issue.id))) === true;
    if (!alreadyNotified) {
      await ctx.state.set(exhaustedKey(issue.id), true);
      await ctx.issues.createComment(issue.id, exhaustedBody(), companyId);
    }
    return { action: "attempt-cap", notified: !alreadyNotified };
  }

  const relations = await ctx.issues.relations.get(issue.id, companyId);
  const dependents = relations.blocks?.length ?? 0;
  await ctx.state.set(attemptKey(issue.id), attempts + 1);
  await ensureCaptureSkill(ctx, companyId);

  if (dependents > 0) {
    await ctx.issues.createComment(issue.id, softReminderBody(dependents), companyId);
    return { action: "soft-reminder", dependents };
  }

  await ctx.issues.update(issue.id, { status: "in_progress" }, companyId);
  await ctx.issues.createComment(
    issue.id,
    contractBody(issue, MAX_GATE_ATTEMPTS - (attempts + 1), allowIssueDocumentFallback),
    companyId,
  );
  try {
    await ctx.issues.requestWakeup(issue.id, companyId);
  } catch (error) {
    ctx.logger.warn("done-memory-gate reverted the issue but could not wake its assignee", {
      issueId: issue.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { action: "reverted", attempts: attempts + 1 };
}
