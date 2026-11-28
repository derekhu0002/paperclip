import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  agents,
  applyPendingMigrations,
  closeRegisteredClients,
  companies,
  createDb,
  environmentLeases,
  heartbeatRunEvents,
  heartbeatRuns,
  type Db,
} from "@paperclipai/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { resolveExternalTestDatabaseUrl } from "../__tests__/helpers/external-test-database.js";
import { environmentService } from "../services/environments.js";
import { remoteExecutionHasStopped } from "../services/remote-execution-termination.js";
import { resolveSshRemoteTermination, sshReleasedLeaseProvesStopped, sshReleaseOptions, sshRunProvesProviderStopped } from "./ssh-remote-termination.js";

describe("sshRunProvesProviderStopped", () => {
  it("accepts a terminal legacy run with no provider execution evidence", () => {
    for (const runStatus of ["succeeded", "failed", "cancelled", "timed_out", "interrupted"]) {
      expect(sshRunProvesProviderStopped({ runtimeMode: "legacy", runStatus, hasExecutionStartEvidence: false })).toBe(true);
    }
  });

  it("rejects a run that recorded provider execution evidence", () => {
    for (const runStatus of ["succeeded", "failed", "cancelled", "timed_out", "interrupted"]) {
      expect(sshRunProvesProviderStopped({ runtimeMode: "legacy", runStatus, hasExecutionStartEvidence: true })).toBe(false);
    }
  });

  it("rejects a run that is not terminal", () => {
    for (const runStatus of ["running", "queued", "scheduled_retry", null, undefined]) {
      expect(sshRunProvesProviderStopped({ runtimeMode: "legacy", runStatus, hasExecutionStartEvidence: false })).toBe(false);
    }
  });

  it("leaves native SSH bookkeeping untouched", () => {
    expect(sshRunProvesProviderStopped({ runtimeMode: "native", runStatus: "succeeded", hasExecutionStartEvidence: false })).toBe(false);
  });
});

const external = resolveExternalTestDatabaseUrl("PAPERCLIP_SSH_TERMINATION_TEST_DATABASE_URL");
// Windows hosts commonly run tests as an administrator, where embedded Postgres
// refuses to start. CI's Linux lanes exercise the integration cases; local
// Windows runs verify the pure predicate and skip the database suite.
const support = external
  ? { supported: true }
  : process.platform === "win32"
    ? { supported: false }
    : await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("SSH remote termination proof (db)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
  let db: Db | undefined;

  beforeAll(async () => {
    try {
      if (external) {
        await applyPendingMigrations(external);
        db = createDb(external);
      } else {
        database = await startEmbeddedPostgresTestDatabase("paperclip-ssh-termination-");
        db = createDb(database.connectionString);
      }
    } catch {
      // Some hosts (for example a Windows administrator account) forbid running
      // embedded Postgres. The integration cases skip; CI's Linux lanes run them.
      db = undefined;
    }
  }, 90_000);

  afterAll(async () => {
    if (external) await closeRegisteredClients(external);
    else await database?.cleanup();
  });

  async function fixture(
    runPatch: Partial<typeof heartbeatRuns.$inferInsert> = {},
    leasePatch: Partial<typeof environmentLeases.$inferInsert> = {},
  ) {
    if (!db) throw new Error("database unavailable");
    const id = randomUUID();
    const [company] = await db.insert(companies).values({ name: "SSH remote", issuePrefix: `S${id.slice(0, 7)}` }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id, name: "OpenCode agent", adapterType: "opencode_local", status: "idle", lifecycleState: "ready",
    }).returning();
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: company.id, agentId: agent.id, status: "cancelled", invocationSource: "on_demand", runtimeMode: "legacy",
      startedAt: new Date("2000-01-01T00:00:00Z"), finishedAt: new Date("2000-01-01T00:00:01Z"),
      ...runPatch,
    }).returning();
    const [lease] = await db.insert(environmentLeases).values({
      companyId: company.id, heartbeatRunId: run.id, provider: "ssh",
      providerLeaseId: `ssh://user@host:22/repos/${id}`, status: "active", leasePolicy: "ephemeral",
      metadata: { driver: "ssh" },
      ...leasePatch,
    }).returning();
    return { company, agent, run, lease };
  }

  it("certifies a stopped SSH lease when the run produced no provider execution evidence", async (ctx) => {
    if (!db) return ctx.skip();
    const { company, run, lease } = await fixture();

    const termination = await resolveSshRemoteTermination(db, lease);
    expect(termination).toMatchObject({ schema: "paperclip.remote-termination.v1", state: "stopped",
      runId: run.id, leaseId: lease.id, provider: "ssh", providerLeaseId: lease.providerLeaseId });

    await environmentService(db).releaseLease(lease.id, "released", sshReleaseOptions(termination));

    const [released] = await db.select().from(environmentLeases).where(eq(environmentLeases.id, lease.id));
    expect(released.status).toBe("released");
    expect(released.cleanupStatus).toBe("success");
    expect(released.metadata?.remoteExecutionTermination).toBeTruthy();

    expect(await remoteExecutionHasStopped(db, company.id, run.id)).toBe(true);
  });

  it("certifies a released SSH lease without a stored receipt when the run never started", async (ctx) => {
    if (!db) return ctx.skip();
    const { company, run, lease } = await fixture();
    await db.update(environmentLeases).set({ status: "released", releasedAt: new Date(), cleanupStatus: "success" })
      .where(eq(environmentLeases.id, lease.id));
    const [released] = await db.select().from(environmentLeases).where(eq(environmentLeases.id, lease.id));

    expect(await sshReleasedLeaseProvesStopped(db, released!)).toBe(true);
    expect(await remoteExecutionHasStopped(db, company.id, run.id)).toBe(false);
  });

  it("does not certify a released SSH lease when the run recorded execution evidence", async (ctx) => {
    if (!db) return ctx.skip();
    const { company, agent, run, lease } = await fixture();
    await db.insert(heartbeatRunEvents).values({
      companyId: company.id, agentId: agent.id, runId: run.id, seq: 1, eventType: "adapter.invoke",
    });
    await db.update(environmentLeases).set({ status: "released", releasedAt: new Date(), cleanupStatus: "success" })
      .where(eq(environmentLeases.id, lease.id));
    const [released] = await db.select().from(environmentLeases).where(eq(environmentLeases.id, lease.id));

    expect(await sshReleasedLeaseProvesStopped(db, released!)).toBe(false);
  });

  it("does not certify a lease that is still pending cleanup", async (ctx) => {
    if (!db) return ctx.skip();
    const { lease } = await fixture();
    expect(await sshReleasedLeaseProvesStopped(db, { ...lease, status: "pending_cleanup", releasedAt: null })).toBe(false);
  });

  it("keeps the safety gate closed when the run recorded provider execution evidence", async (ctx) => {
    if (!db) return ctx.skip();
    const { company, agent, run, lease } = await fixture();
    await db.insert(heartbeatRunEvents).values({
      companyId: company.id, agentId: agent.id, runId: run.id, seq: 1, eventType: "adapter.invoke",
    });

    const termination = await resolveSshRemoteTermination(db, lease);
    expect(termination).toBeUndefined();

    await environmentService(db).releaseLease(lease.id, "released", sshReleaseOptions(termination));
    const [released] = await db.select().from(environmentLeases).where(eq(environmentLeases.id, lease.id));
    expect(released.metadata?.remoteExecutionTermination).toBeUndefined();
    expect(await remoteExecutionHasStopped(db, company.id, run.id)).toBe(false);
  });

  it("does not certify a lease whose run is not terminal", async (ctx) => {
    if (!db) return ctx.skip();
    const { lease } = await fixture({ status: "running", finishedAt: null });
    expect(await resolveSshRemoteTermination(db, lease)).toBeUndefined();
  });

  it("does not certify a non-SSH lease", async (ctx) => {
    if (!db) return ctx.skip();
    const { lease } = await fixture({}, { provider: "local", providerLeaseId: null });
    expect(await resolveSshRemoteTermination(db, lease)).toBeUndefined();
  });

  it("does not certify a native SSH run", async (ctx) => {
    if (!db) return ctx.skip();
    const { lease } = await fixture({ runtimeMode: "native" });
    expect(await resolveSshRemoteTermination(db, lease)).toBeUndefined();
  });
});
