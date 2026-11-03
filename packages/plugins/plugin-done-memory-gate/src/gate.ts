import type { Issue, PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import {
  CONTRACT_COMMENT_PREFIX,
  MEMORY_DOCUMENT_KEY,
  PLUGIN_ID,
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
  | { action: "reminded"; followUpIssueId: string };

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

function followUpDescription(issue: Issue, documentFallback: boolean): string {
  return [
    `这是 done-memory-gate 自动创建的收尾任务：${issueLabel(issue)} 已完成，但未检测到图谱记忆。`,
    "",
    "请在这个任务里完成记忆捕获，然后把它置为 done：",
    "",
    `1. 读原任务 ${issueLabel(issue)}（父任务）的最终 comment、文档和结果。`,
    "2. 把经验教训、关键决策（含被否决方案与原因）、坑与修复，写入项目 ARGO/ArchGraph 记忆图（T2 长期记忆）：",
    "   使用 addArchitectureElement（或 updateArchitectureElement），拿到返回的元素 id。",
    `3. 在本任务留一行引用：\`memory-capture: argo:<graphKey>#<elementId>\`（例如 argo:design/KG/SystemArchitecture.json#memory-xxx）。`,
    ...(documentFallback
      ? ["", `本实例允许兜底：保存 ${MEMORY_DOCUMENT_KEY} 文档（200+ 字符）也可以。`]
      : []),
  ].join("\n");
}

function reminderComment(followUpIssueId: string): string {
  return [
    `${CONTRACT_COMMENT_PREFIX} 本任务已结束，但未检测到图谱记忆。`,
    "",
    `已创建收尾任务 ${followUpIssueId} 并指派给同一 Agent；完成后把记忆元素引用写在那条任务的 comment 中。`,
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
    const followUp = await ctx.issues.create({
      companyId,
      projectId: issue.projectId ?? undefined,
      parentId: issue.id,
      title: `记录任务记忆：${issueLabel(issue)}`,
      description: followUpDescription(issue, allowIssueDocumentFallback),
      status: "todo",
      priority: "low",
      assigneeAgentId: issue.assigneeAgentId,
      originKind: `plugin:${PLUGIN_ID}`,
      originId: issue.id,
    });
    await ctx.issues.createComment(issue.id, reminderComment(followUp.id), companyId);
    return { action: "reminded", followUpIssueId: followUp.id };
  } catch (error) {
    await ctx.state.set(remindedKey(issue.id), false);
    throw error;
  }
}
