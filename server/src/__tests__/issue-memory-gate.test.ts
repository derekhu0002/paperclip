import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, companies, createDb, issueComments, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  assertAgentMemoryCaptureBeforeDone,
  DONE_MEMORY_GATE_CODE,
  findMemoryCaptureMarker,
  isDoneMemoryGateEnabled,
  parseMemoryCaptureMarker,
} from "../services/issue-memory-gate.js";

describe("task memory protocol v2 parsing", () => {
  it("parses a graph reference and an explicit exemption", () => {
    expect(parseMemoryCaptureMarker("argo:design/KG/SystemArchitecture.json#memory-1"))
      .toEqual({ kind: "graph", graphKey: "design/KG/SystemArchitecture.json", elementId: "memory-1" });
    expect(parseMemoryCaptureMarker("none: ARGO MCP unavailable in this harness"))
      .toEqual({ kind: "exempt", reason: "ARGO MCP unavailable in this harness" });
    expect(parseMemoryCaptureMarker("none:")).toBeNull();
    expect(parseMemoryCaptureMarker("doc:memory")).toBeNull();
    expect(parseMemoryCaptureMarker("argo:no-element")).toBeNull();
    expect(parseMemoryCaptureMarker(null)).toBeNull();
  });

  it("keeps the memory-capture prefix case-sensitive", () => {
    expect(findMemoryCaptureMarker("done\nmemory-capture: argo:g#e")).toBe("argo:g#e");
    expect(findMemoryCaptureMarker("done\nMemory-Capture: argo:g#e")).toBeNull();
  });

  it("honors the kill switch", () => {
    expect(isDoneMemoryGateEnabled({})).toBe(true);
    expect(isDoneMemoryGateEnabled({ PAPERCLIP_DONE_MEMORY_GATE: "on" })).toBe(true);
    expect(isDoneMemoryGateEnabled({ PAPERCLIP_DONE_MEMORY_GATE: "off" })).toBe(false);
    expect(isDoneMemoryGateEnabled({ PAPERCLIP_DONE_MEMORY_GATE: "0" })).toBe(false);
    expect(isDoneMemoryGateEnabled({ PAPERCLIP_DONE_MEMORY_GATE: "disabled" })).toBe(false);
  });
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("task memory gate on a real database", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    process.env.PAPERCLIP_DONE_MEMORY_GATE = "on";
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-memory-gate-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedIssue(status = "in_progress") {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Memory gate",
      issuePrefix: `MG${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Memory gate agent",
      role: "engineer",
      status: "active",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Gate task",
      status,
      priority: "medium",
      assigneeAgentId: agentId,
    });
    return { companyId, agentId, issueId };
  }

  async function readIssue(issueId: string) {
    return (await db.select().from(issues).where(eq(issues.id, issueId)))[0]!;
  }

  async function activities(issueId: string, action: string) {
    return db.select().from(activityLog).where(and(
      eq(activityLog.entityId, issueId),
      eq(activityLog.action, action),
    ));
  }

  it("blocks the first miss with actionable feedback and records the block", async () => {
    const { agentId, issueId } = await seedIssue();

    await expect(assertAgentMemoryCaptureBeforeDone({
      db,
      issue: await readIssue(issueId),
      actorAgentId: agentId,
    })).rejects.toMatchObject({
      status: 409,
      details: {
        code: DONE_MEMORY_GATE_CODE,
        attempt: 1,
        maxAttempts: 2,
        accepts: "memory-capture: argo:<graphKey>#<elementId>",
        exempt: "memory-capture: none: <reason>",
      },
    });
    expect(await activities(issueId, "issue.memory_gate_blocked")).toHaveLength(1);
  });

  it("allows the transition after two blocks and records memory-capture missed", async () => {
    const { agentId, issueId } = await seedIssue();

    await expect(assertAgentMemoryCaptureBeforeDone({
      db, issue: await readIssue(issueId), actorAgentId: agentId,
    })).rejects.toMatchObject({ status: 409 });
    await expect(assertAgentMemoryCaptureBeforeDone({
      db, issue: await readIssue(issueId), actorAgentId: agentId,
    })).rejects.toMatchObject({ status: 409 });
    await expect(assertAgentMemoryCaptureBeforeDone({
      db, issue: await readIssue(issueId), actorAgentId: agentId,
    })).resolves.toBeUndefined();

    expect(await activities(issueId, "issue.memory_gate_blocked")).toHaveLength(2);
    expect(await activities(issueId, "issue.memory_gate_missed")).toHaveLength(1);
  });

  it("accepts a graph reference in the request comment", async () => {
    const { agentId, issueId } = await seedIssue();

    await expect(assertAgentMemoryCaptureBeforeDone({
      db,
      issue: await readIssue(issueId),
      actorAgentId: agentId,
      requestCommentBody: "Finished.\nmemory-capture: argo:design/KG/SystemArchitecture.json#memory-1",
    })).resolves.toBeUndefined();
    expect(await activities(issueId, "issue.memory_gate_blocked")).toHaveLength(0);
  });

  it("accepts a graph reference from an earlier comment", async () => {
    const { companyId, agentId, issueId } = await seedIssue();
    await db.insert(issueComments).values({
      id: randomUUID(),
      companyId,
      issueId,
      authorType: "agent",
      authorAgentId: agentId,
      authorUserId: null,
      body: "Memory written.\nmemory-capture: argo:design/KG/SystemArchitecture.json#memory-2",
      presentation: null,
      metadata: null,
    });

    await expect(assertAgentMemoryCaptureBeforeDone({
      db, issue: await readIssue(issueId), actorAgentId: agentId,
    })).resolves.toBeUndefined();
  });

  it("allows an explicit none: exemption and records the reason", async () => {
    const { agentId, issueId } = await seedIssue();

    await expect(assertAgentMemoryCaptureBeforeDone({
      db,
      issue: await readIssue(issueId),
      actorAgentId: agentId,
      requestCommentBody: "Finished.\nmemory-capture: none: ARGO MCP unavailable in this harness",
    })).resolves.toBeUndefined();

    const [exempted] = await activities(issueId, "issue.memory_gate_exempted");
    expect(exempted?.details).toMatchObject({ reason: "ARGO MCP unavailable in this harness" });
  });

  it("treats an uppercase prefix as missing", async () => {
    const { agentId, issueId } = await seedIssue();

    await expect(assertAgentMemoryCaptureBeforeDone({
      db,
      issue: await readIssue(issueId),
      actorAgentId: agentId,
      requestCommentBody: "Finished.\nMemory-Capture: argo:g#e",
    })).rejects.toMatchObject({ status: 409 });
  });

  it("skips non-agent, unassigned, and already-done issues", async () => {
    const { agentId, issueId } = await seedIssue();
    const done = await seedIssue("done");

    await expect(assertAgentMemoryCaptureBeforeDone({
      db, issue: await readIssue(issueId), actorAgentId: null,
    })).resolves.toBeUndefined();
    await expect(assertAgentMemoryCaptureBeforeDone({
      db, issue: { ...(await readIssue(issueId)), assigneeAgentId: null }, actorAgentId: agentId,
    })).resolves.toBeUndefined();
    await expect(assertAgentMemoryCaptureBeforeDone({
      db, issue: await readIssue(done.issueId), actorAgentId: done.agentId,
    })).resolves.toBeUndefined();
  });
});
