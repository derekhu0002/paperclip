import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  agents,
  applyPendingMigrations,
  closeRegisteredClients,
  companies,
  createDb,
  environmentLeases,
  environments,
  heartbeatRuns,
  type Db,
} from "@paperclipai/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { resolveExternalTestDatabaseUrl } from "../__tests__/helpers/external-test-database.js";
import { remoteExecutionHasStopped } from "../services/remote-execution-termination.js";
import {
  buildSshRunStopScript,
  persistSshRemoteStopReceipt,
  resolveSshRemoteStopReceipt,
  SSH_REMOTE_STOPPED_MARKER,
} from "./ssh-remote-stop.js";

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("buildSshRunStopScript", () => {
  it("terminates only processes carrying the exact run id and reports stopped", async () => {
    const runId = randomUUID();
    const otherRunId = randomUUID();
    const baseEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
    const victim = spawn("sleep", ["30"], { env: { ...baseEnv, PAPERCLIP_RUN_ID: runId }, stdio: "ignore" });
    const control = spawn("sleep", ["30"], { env: { ...baseEnv, PAPERCLIP_RUN_ID: otherRunId }, stdio: "ignore" });
    const victimExited = new Promise<boolean>(resolve => victim.once("exit", () => resolve(true)));
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !processAlive(victim.pid!)) await new Promise(r => setTimeout(r, 25));

      const result = spawnSync("sh", ["-c", buildSshRunStopScript(runId)], {
        encoding: "utf8",
        timeout: 15_000,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`${SSH_REMOTE_STOPPED_MARKER} ${runId}`);
      expect(await Promise.race([victimExited, new Promise<boolean>(r => setTimeout(() => r(false), 5000))])).toBe(true);
      expect(processAlive(control.pid!)).toBe(true);
    } finally {
      try { victim.kill("SIGKILL"); } catch { /* already gone */ }
      try { control.kill("SIGKILL"); } catch { /* already gone */ }
    }
  }, 30_000);

  it("shell-quotes the run id so it cannot inject a command", () => {
    expect(buildSshRunStopScript(`x'; kill -9 1; echo '`)).toContain(`run_id='x'\\''; kill -9 1; echo '\\'''`);
  });
});

const external = resolveExternalTestDatabaseUrl("PAPERCLIP_SSH_REMOTE_STOP_TEST_DATABASE_URL");
const support = external
  ? { supported: true }
  : process.platform === "win32"
    ? { supported: false }
    : await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("SSH remote stop proof (db)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
  let db: Db | undefined;

  beforeAll(async () => {
    try {
      if (external) {
        await applyPendingMigrations(external);
        db = createDb(external);
      } else {
        database = await startEmbeddedPostgresTestDatabase("paperclip-ssh-remote-stop-");
        db = createDb(database.connectionString);
      }
    } catch {
      db = undefined;
    }
  }, 90_000);

  afterAll(async () => {
    if (external) await closeRegisteredClients(external);
    else await database?.cleanup();
  });

  async function fixture(runPatch: Partial<typeof heartbeatRuns.$inferInsert> = {}) {
    if (!db) throw new Error("database unavailable");
    const id = randomUUID();
    const [company] = await db.insert(companies).values({ name: "SSH remote stop", issuePrefix: `R${id.slice(0, 7)}` }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id, name: "OpenCode agent", adapterType: "opencode_local", status: "idle", lifecycleState: "ready",
    }).returning();
    const [environment] = await db.insert(environments).values({
      name: `ssh-${id}`,
      driver: "ssh",
      config: {
        host: "127.0.0.1", port: 2222, username: "root", remoteWorkspacePath: "/tmp",
        privateKey: null, knownHosts: null, strictHostKeyChecking: false,
      },
    }).returning();
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: company.id, agentId: agent.id, status: "cancelled", invocationSource: "on_demand", runtimeMode: "legacy",
      startedAt: new Date("2000-01-01T00:00:00Z"), finishedAt: new Date("2000-01-01T00:00:01Z"),
      ...runPatch,
    }).returning();
    const [lease] = await db.insert(environmentLeases).values({
      companyId: company.id, heartbeatRunId: run.id, environmentId: environment.id, provider: "ssh",
      providerLeaseId: `ssh://root@127.0.0.1:2222/tmp/${id}`, status: "released", releasedAt: new Date(),
      cleanupStatus: null, leasePolicy: "ephemeral",
      metadata: { driver: "ssh", remoteCwd: "/tmp", environmentId: environment.id },
    }).returning();
    return { company, run, lease, environment };
  }

  it("records a stopped receipt only when the remote host proves the run gone", async (ctx) => {
    if (!db) return ctx.skip();
    const { company, run, lease } = await fixture();
    const runCommand = vi.fn(async () => ({ stdout: `${SSH_REMOTE_STOPPED_MARKER} ${run.id}\n`, stderr: "" }));

    const receipt = await resolveSshRemoteStopReceipt(db, lease, { runCommand });
    expect(receipt).toMatchObject({ schema: "paperclip.remote-termination.v1", state: "stopped", proof: "remote_process_scan" });

    expect(await persistSshRemoteStopReceipt(db, lease, { runCommand })).toBe(true);
    const [released] = await db.select().from(environmentLeases).where(eq(environmentLeases.id, lease.id));
    expect(released.cleanupStatus).toBe("success");
    expect(released.metadata?.remoteExecutionTermination).toMatchObject({
      schema: "paperclip.remote-termination.v1", runId: run.id, leaseId: lease.id,
    });
    expect(await remoteExecutionHasStopped(db, company.id, run.id)).toBe(true);
  });

  it("does not certify when the remote host still reports the run", async (ctx) => {
    if (!db) return ctx.skip();
    const { lease, run } = await fixture();
    const runCommand = vi.fn(async () => ({ stdout: `PAPERCLIP_REMOTE_RUN_STILL_RUNNING ${run.id}\n`, stderr: "" }));
    expect(await resolveSshRemoteStopReceipt(db, lease, { runCommand })).toBeUndefined();
    expect(await persistSshRemoteStopReceipt(db, lease, { runCommand })).toBe(false);
  });

  it("does not probe a run that is still active", async (ctx) => {
    if (!db) return ctx.skip();
    const { lease } = await fixture({ status: "running", finishedAt: null });
    const runCommand = vi.fn(async () => ({ stdout: `${SSH_REMOTE_STOPPED_MARKER} ${lease.heartbeatRunId}\n`, stderr: "" }));
    expect(await resolveSshRemoteStopReceipt(db, lease, { runCommand })).toBeUndefined();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("does not probe a native SSH run", async (ctx) => {
    if (!db) return ctx.skip();
    const { lease } = await fixture({ runtimeMode: "native" });
    const runCommand = vi.fn(async () => ({ stdout: `${SSH_REMOTE_STOPPED_MARKER} ${lease.heartbeatRunId}\n`, stderr: "" }));
    expect(await resolveSshRemoteStopReceipt(db, lease, { runCommand })).toBeUndefined();
    expect(runCommand).not.toHaveBeenCalled();
  });
});
