import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";
import { DONE_MEMORY_GATE_CODE } from "../services/issue-memory-gate.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("issue route done memory gate", () => {
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

  it("returns 409 task_memory_required for an agent done without graph memory", async () => {
    const { runId, issueId } = await seedCheckedOutIssue("Gate route blocked task");

    const res = await request(appFor(runId))
      .patch(`/api/issues/${issueId}`)
      .send({ status: "done" });

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe(DONE_MEMORY_GATE_CODE);
    expect(res.body.remediation).toContain("memory-capture: argo:");
    expect((await db.select().from(issues).where(eq(issues.id, issueId)))[0]?.status)
      .toBe("in_progress");
  });

  it("accepts an agent done that carries the graph reference in its closing comment", async () => {
    const { runId, issueId } = await seedCheckedOutIssue("Gate route pass task");

    const res = await request(appFor(runId))
      .patch(`/api/issues/${issueId}`)
      .send({
        status: "done",
        comment: "Finished.\nmemory-capture: argo:design/KG/SystemArchitecture.json#memory-route-1",
      });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("done");
  });
});
