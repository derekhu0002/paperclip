import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, issueComments, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  assertAgentMemoryCaptureBeforeDone,
  DONE_MEMORY_GATE_CODE,
  findMemoryCaptureMarker,
  isDoneMemoryGateEnabled,
  isGraphMemoryReference,
} from "../services/issue-memory-gate.js";

function fakeDb(rows: Array<{ body: string | null }>) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => rows,
          }),
        }),
      }),
    }),
  } as never;
}

const baseIssue = {
  id: "issue-1",
  companyId: "company-1",
  identifier: "GATE-1",
  status: "in_progress",
  assigneeAgentId: "agent-1",
};

process.env.PAPERCLIP_DONE_MEMORY_GATE = "on";

describe("done memory gate evidence", () => {
  it("parses a graph-qualified memory marker", () => {
    expect(findMemoryCaptureMarker("done\nmemory-capture: argo:g#e")).toBe("argo:g#e");
    expect(isGraphMemoryReference("argo:design/KG/SystemArchitecture.json#memory-1")).toBe(true);
    expect(isGraphMemoryReference("doc:memory")).toBe(false);
    expect(isGraphMemoryReference("argo:no-element")).toBe(false);
    expect(isGraphMemoryReference(null)).toBe(false);
  });

  it("honors the kill switch", () => {
    expect(isDoneMemoryGateEnabled({})).toBe(true);
    expect(isDoneMemoryGateEnabled({ PAPERCLIP_DONE_MEMORY_GATE: "on" })).toBe(true);
    expect(isDoneMemoryGateEnabled({ PAPERCLIP_DONE_MEMORY_GATE: "off" })).toBe(false);
    expect(isDoneMemoryGateEnabled({ PAPERCLIP_DONE_MEMORY_GATE: "0" })).toBe(false);
    expect(isDoneMemoryGateEnabled({ PAPERCLIP_DONE_MEMORY_GATE: "disabled" })).toBe(false);
  });
});

describe("assertAgentMemoryCaptureBeforeDone", () => {
  it("rejects an agent done without any memory reference", async () => {
    await expect(assertAgentMemoryCaptureBeforeDone({
      db: fakeDb([]),
      issue: baseIssue,
      actorAgentId: "agent-1",
    })).rejects.toMatchObject({
      status: 409,
      details: { code: DONE_MEMORY_GATE_CODE },
    });
  });

  it("accepts a reference in the same request comment", async () => {
    await expect(assertAgentMemoryCaptureBeforeDone({
      db: fakeDb([]),
      issue: baseIssue,
      actorAgentId: "agent-1",
      requestCommentBody: "Done.\nmemory-capture: argo:design/KG/SystemArchitecture.json#memory-9",
    })).resolves.toBeUndefined();
  });

  it("accepts a reference from an earlier comment", async () => {
    await expect(assertAgentMemoryCaptureBeforeDone({
      db: fakeDb([{ body: "notes\nmemory-capture: argo:g#e" }]),
      issue: baseIssue,
      actorAgentId: "agent-1",
    })).resolves.toBeUndefined();
  });

  it("skips non-agent, unassigned, and already-done issues", async () => {
    await expect(assertAgentMemoryCaptureBeforeDone({
      db: fakeDb([]),
      issue: baseIssue,
      actorAgentId: null,
    })).resolves.toBeUndefined();
    await expect(assertAgentMemoryCaptureBeforeDone({
      db: fakeDb([]),
      issue: { ...baseIssue, assigneeAgentId: null },
      actorAgentId: "agent-1",
    })).resolves.toBeUndefined();
    await expect(assertAgentMemoryCaptureBeforeDone({
      db: fakeDb([]),
      issue: { ...baseIssue, status: "done" },
      actorAgentId: "agent-1",
    })).resolves.toBeUndefined();
  });
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("done memory gate database reads", () => {
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

  async function seedIssue() {
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
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    return { companyId, agentId, issueId };
  }

  async function readIssue(issueId: string) {
    return (await db.select().from(issues).where(eq(issues.id, issueId)))[0]!;
  }

  it("rejects an agent done without graph memory", async () => {
    const { agentId, issueId } = await seedIssue();

    await expect(assertAgentMemoryCaptureBeforeDone({
      db,
      issue: await readIssue(issueId),
      actorAgentId: agentId,
    })).rejects.toMatchObject({
      status: 409,
      details: { code: DONE_MEMORY_GATE_CODE },
    });
  });

  it("accepts when the request comment carries a graph reference", async () => {
    const { agentId, issueId } = await seedIssue();

    await expect(assertAgentMemoryCaptureBeforeDone({
      db,
      issue: await readIssue(issueId),
      actorAgentId: agentId,
      requestCommentBody: "Finished.\nmemory-capture: argo:design/KG/SystemArchitecture.json#memory-1",
    })).resolves.toBeUndefined();
  });

  it("accepts when an earlier comment carries a graph reference", async () => {
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
      db,
      issue: await readIssue(issueId),
      actorAgentId: agentId,
    })).resolves.toBeUndefined();
  });
});
