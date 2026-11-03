import type { Agent, Issue, IssueComment } from "@paperclipai/plugin-sdk";

export const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
export const AGENT_ID = "22222222-2222-4222-8222-222222222222";

export function makeIssue(overrides: Partial<Issue> & Pick<Issue, "id">): Issue {
  return {
    id: overrides.id,
    companyId: COMPANY_ID,
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    title: "Task",
    description: null,
    status: "done",
    workMode: "standard",
    priority: "medium",
    reviewPolicy: null,
    assigneeAgentId: AGENT_ID,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    createdByAgentId: AGENT_ID,
    createdByUserId: null,
    responsibleUserId: null,
    issueNumber: 1,
    identifier: "PAP-1",
    originKind: "manual",
    originId: null,
    originRunId: null,
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    ...overrides,
  } as Issue;
}

export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: AGENT_ID,
    companyId: COMPANY_ID,
    name: "Test Agent",
    status: "idle",
    ...overrides,
  } as Agent;
}

export function makeComment(issue: Issue, body: string): IssueComment {
  const now = new Date();
  return {
    id: `${issue.id}-comment-${Math.random().toString(36).slice(2, 8)}`,
    companyId: issue.companyId,
    issueId: issue.id,
    authorType: "agent",
    authorAgentId: AGENT_ID,
    authorUserId: null,
    onBehalfOfUserId: null,
    body,
    presentation: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  } as IssueComment;
}

export function doneEvent(input: {
  issue: Issue;
  actorType?: "agent" | "user" | "system" | "plugin";
}) {
  return {
    payload: {
      status: "done",
      changes: { status: { from: "in_progress", to: "done" } },
      _previous: { status: "in_progress" },
    },
    base: {
      companyId: input.issue.companyId,
      entityId: input.issue.id,
      entityType: "issue",
      actorId: input.actorType === "user" ? "board-user" : "actor-agent",
      actorType: input.actorType ?? "agent",
    },
  };
}
