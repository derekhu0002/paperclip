import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, companies, createDb, heartbeatRuns, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";
import { DONE_MEMORY_GATE_CODE } from "../services/issue-memory-gate.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("issue route task memory gate", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId!: string;
  let agentId!: string;

  beforeAll(async () => {
    process.env.PAPERCLIP_DONE_MEMORY_GATE = "on";
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-memory-gate-route-");
    db = createDb(tempDb.connectionString);
    companyId = randomUUID();
    agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Memory gate route",
      issuePrefix: "MGR",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Gate agent",
      role: "engineer",
      status: "active",
    });
  }, 30_000);

  afterAll(async () => {
    // The done route flushes post-commit actions asynchronously; let them settle
    // before the embedded database closes so teardown does not see a stray query.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await tempDb?.cleanup();
  });

  async function seedCheckedOutIssue(title: string) {
    const runId = randomUUID();
    const issueId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      scopeKind: "issue",
      issueId,
      status: "running",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title,
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      checkoutRunId: runId,
    });
    return { runId, issueId };
  }

  function appFor(runId: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { actor: Record<string, unknown> }).actor = {
        type: "agent",
        agentId,
        companyId,
        source: "agent_key",
        runId,
      };
      next();
    });
    app.use("/api", issueRoutes(db, {} as never));
    app.use(errorHandler);
    return app;
  }

  function markDone(issueId: string, runId: string, body: Record<string, unknown> = {}) {
    return request(appFor(runId))
      .patch(`/api/issues/${issueId}`)
      .send({ status: "done", ...body });
  }

  it("blocks twice with task_memory_required, then allows and records missed", async () => {
    const { runId, issueId } = await seedCheckedOutIssue("Gate route capped task");

    const first = await markDone(issueId, runId);
    expect(first.status, JSON.stringify(first.body)).toBe(409);
    expect(first.body.code).toBe(DONE_MEMORY_GATE_CODE);
    expect(first.body.remediation).toContain("memory-capture: argo:");

    const second = await markDone(issueId, runId);
    expect(second.status, JSON.stringify(second.body)).toBe(409);

    const third = await markDone(issueId, runId);
    expect(third.status, JSON.stringify(third.body)).toBe(200);
    expect(third.body.status).toBe("done");

    const missed = await db.select().from(activityLog).where(and(
      eq(activityLog.entityId, issueId),
      eq(activityLog.action, "issue.memory_gate_missed"),
    ));
    expect(missed).toHaveLength(1);
  });

  it("accepts a done that ends its closing comment with a graph reference", async () => {
    const { runId, issueId } = await seedCheckedOutIssue("Gate route pass task");

    const res = await markDone(issueId, runId, {
      comment: "Finished.\nmemory-capture: argo:design/KG/SystemArchitecture.json#memory-route-1",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("done");
  });

  it("accepts an explicit none: exemption", async () => {
    const { runId, issueId } = await seedCheckedOutIssue("Gate route exempt task");

    const res = await markDone(issueId, runId, {
      comment: "Finished.\nmemory-capture: none: ARGO MCP unavailable in this harness",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const exempted = await db.select().from(activityLog).where(and(
      eq(activityLog.entityId, issueId),
      eq(activityLog.action, "issue.memory_gate_exempted"),
    ));
    expect(exempted).toHaveLength(1);
  });
});
