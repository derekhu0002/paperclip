import type { Issue, PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import {
  CONTRACT_COMMENT_PREFIX,
  MEMORY_DOCUMENT_KEY,
  STATE_KEY_REMINDED,
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
  | { action: "reminded"; runId: string };

function remindedKey(issueId: string) {
  return {
    scopeKind: "issue" as const,
    scopeId: issueId,
    namespace: STATE_NAMESPACE,
    stateKey: STATE_KEY_REMINDED,
  };
}

function issueLabel(issue: Issue): string {
  return issue.identifier ?? issue.id;
}

function capturePrompt(issue: Issue, documentFallback: boolean): string {
  return [
    `【记忆收尾】你刚完成的任务 ${issueLabel(issue)}（${issue.title}）已置为 done，但项目 ARGO/ArchGraph 记忆图里还没有本次对话的元素。`,
    "",
    "请基于这次任务的实际结果，把经验教训、关键决策（含被否决方案与原因）、坑与修复整理成一个 T2 长期记忆元素：",
    "使用 addArchitectureElement（或 updateArchitectureElement）写入项目图（design/KG/SystemArchitecture.json），拿到返回的元素 id。",
    "然后在回复中给出：`memory-capture: argo:<graphKey>#<elementId>`。",
    ...(documentFallback
      ? [`本实例允许兜底：保存 ${MEMORY_DOCUMENT_KEY} 文档（200+ 字符）也可以。`]
      : []),
    "不要创建新任务，也不要重新打开原任务。",
  ].join("\n");
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

  if ((await ctx.state.get(remindedKey(issue.id))) === true) {
    return { action: "ignored", reason: "already reminded" };
  }
  await ctx.state.set(remindedKey(issue.id), true);

  try {
    const { runId } = await ctx.agents.invoke(issue.assigneeAgentId, companyId, {
      reason: "done_memory_capture",
      prompt: capturePrompt(issue, allowIssueDocumentFallback),
    });
    return { action: "reminded", runId };
  } catch (error) {
    await ctx.state.set(remindedKey(issue.id), false);
    ctx.logger.warn("done-memory-gate could not wake the agent for memory capture", {
      issueId: issue.id,
      agentId: issue.assigneeAgentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { action: "ignored", reason: "agent invoke failed" };
  }
}
