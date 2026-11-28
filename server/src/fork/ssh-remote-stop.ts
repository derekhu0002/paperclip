import { and, eq, inArray, sql } from "drizzle-orm";
import { environmentLeases, environments, heartbeatRuns, type Db } from "@paperclipai/db";
import type { EnvironmentLease } from "@paperclipai/shared";
import { runSshCommand, type SshConnectionConfig } from "@paperclipai/adapter-utils/ssh";
import { resolveEnvironmentDriverConfigForRuntime } from "../services/environment-config.js";
import { remoteTerminationReceipt } from "../services/remote-execution-termination.js";

/**
 * Fork helper: prove that nothing from a legacy SSH run is still executing on the
 * remote host, and only then certify a `stopped` receipt.
 *
 * An SSH environment is a persistent remote workspace, so cancelling the run
 * closes the local `ssh` client but cannot by itself prove the remote process
 * exited. `ssh-remote-termination.ts` can certify a run that never started; a run
 * that did start needs real remote evidence. The adapters export
 * `PAPERCLIP_RUN_ID` into the remote process environment, which gives us an exact
 * run identity: scan `/proc/<pid>/environ` on the remote host, terminate every
 * matching process (and therefore its inheriting tree), re-scan, and report
 * stopped only when nothing remains.
 *
 * This never guesses from an exit code or a released lease. If the scan fails,
 * times out, cannot reach the host, or still finds a process, no receipt is
 * produced and the existing recovery gate stays closed.
 */

const STOP_PROOF_STATUSES = ["cancelled", "failed", "timed_out", "interrupted"] as const;
const REMOTE_STOP_TIMEOUT_MS = 15_000;
const REMOTE_STOP_MAX_BUFFER_BYTES = 64 * 1024;
export const SSH_REMOTE_STOPPED_MARKER = "PAPERCLIP_REMOTE_RUN_STOPPED";
export const SSH_REMOTE_STILL_RUNNING_MARKER = "PAPERCLIP_REMOTE_RUN_STILL_RUNNING";

export type SshRemoteCommandRunner = (
  config: SshConnectionConfig,
  command: string,
  options?: { timeoutMs?: number; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface SshRemoteStopDeps {
  runCommand?: SshRemoteCommandRunner;
}

type StopLease = Pick<
  EnvironmentLease,
  "id" | "companyId" | "environmentId" | "heartbeatRunId" | "provider" | "providerLeaseId" | "metadata"
>;

function isSshLease(lease: Pick<StopLease, "provider" | "metadata">): boolean {
  return lease.provider === "ssh" || lease.metadata?.driver === "ssh";
}

function leaseEnvironmentId(lease: StopLease): string | null {
  if (lease.environmentId) return lease.environmentId;
  const fromMetadata = lease.metadata?.environmentId;
  return typeof fromMetadata === "string" && fromMetadata.length > 0 ? fromMetadata : null;
}

/**
 * Remote shell script: find every process whose environment carries this run's
 * `PAPERCLIP_RUN_ID`, terminate it, verify it is gone, and print a marker only
 * when the host is clean. Exits 3 when a matching process survives.
 */
export function buildSshRunStopScript(runId: string): string {
  const quotedRunId = `'${runId.replace(/'/g, `'\\''`)}'`;
  return [
    "set -u",
    `run_id=${quotedRunId}`,
    `marker='${SSH_REMOTE_STOPPED_MARKER}'`,
    `still='${SSH_REMOTE_STILL_RUNNING_MARKER}'`,
    "list_pids() {",
    "  for d in /proc/[0-9]*; do",
    '    [ -r "$d/environ" ] || continue',
    '    if tr \'\\0\' \'\\n\' < "$d/environ" 2>/dev/null | grep -qxF "PAPERCLIP_RUN_ID=$run_id"; then',
    '      printf \'%s\\n\' "${d#/proc/}"',
    "    fi",
    "  done",
    "}",
    "pids=$(list_pids)",
    'if [ -n "$pids" ]; then',
    '  for p in $pids; do kill -TERM "$p" 2>/dev/null || true; done',
    "  sleep 2",
    "  pids=$(list_pids)",
    '  for p in $pids; do kill -KILL "$p" 2>/dev/null || true; done',
    '  if [ -n "$pids" ]; then sleep 1; pids=$(list_pids); fi',
    "fi",
    'if [ -n "$pids" ]; then printf \'%s %s\\n\' "$still" "$run_id"; exit 3; fi',
    'printf \'%s %s\\n\' "$marker" "$run_id"',
  ].join("\n");
}

async function readStopProofRun(
  db: Db,
  lease: StopLease,
): Promise<{ status: string; runtimeMode: string | null } | null> {
  if (!lease.heartbeatRunId) return null;
  const [run] = await db
    .select({ status: heartbeatRuns.status, runtimeMode: heartbeatRuns.runtimeMode })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.id, lease.heartbeatRunId), eq(heartbeatRuns.companyId, lease.companyId)));
  if (!run) return null;
  if (!(STOP_PROOF_STATUSES as readonly string[]).includes(run.status)) return null;
  // Native SSH runs keep their own stop contract; only legacy runs are ours.
  if (run.runtimeMode !== "legacy") return null;
  return run;
}

async function resolveSshConnectionConfig(
  db: Db,
  lease: StopLease,
): Promise<SshConnectionConfig | undefined> {
  const environmentId = leaseEnvironmentId(lease);
  if (!environmentId) return undefined;
  const [environment] = await db
    .select({ id: environments.id, driver: environments.driver, config: environments.config })
    .from(environments)
    .where(eq(environments.id, environmentId));
  if (!environment || environment.driver !== "ssh") return undefined;
  let resolved;
  try {
    resolved = await resolveEnvironmentDriverConfigForRuntime(db, lease.companyId, {
      id: environment.id,
      driver: "ssh",
      config: environment.config ?? {},
    }, { heartbeatRunId: lease.heartbeatRunId });
  } catch {
    return undefined;
  }
  if (resolved.driver !== "ssh") return undefined;
  return resolved.config;
}

/**
 * Resolve a truthful `stopped` receipt from real remote evidence, or `undefined`.
 * Never writes; callers pass the receipt to `releaseLease` or persist it through
 * `persistSshRemoteStopReceipt`.
 */
export async function resolveSshRemoteStopReceipt(
  db: Db,
  lease: StopLease,
  deps: SshRemoteStopDeps = {},
): Promise<Record<string, unknown> | undefined> {
  if (!isSshLease(lease)) return undefined;
  if (!lease.heartbeatRunId || !lease.providerLeaseId) return undefined;
  if (!(await readStopProofRun(db, lease))) return undefined;
  const config = await resolveSshConnectionConfig(db, lease);
  if (!config) return undefined;

  let result: { stdout: string; stderr: string };
  try {
    result = await (deps.runCommand ?? runSshCommand)(config, buildSshRunStopScript(lease.heartbeatRunId), {
      timeoutMs: REMOTE_STOP_TIMEOUT_MS,
      maxBuffer: REMOTE_STOP_MAX_BUFFER_BYTES,
    });
  } catch {
    return undefined;
  }
  if (!result.stdout.includes(`${SSH_REMOTE_STOPPED_MARKER} ${lease.heartbeatRunId}`)) return undefined;

  const receipt = remoteTerminationReceipt(lease, {
    providerLeaseId: lease.providerLeaseId,
    state: "stopped",
  });
  return receipt ? { ...receipt, proof: "remote_process_scan" } : undefined;
}

/**
 * Persist the remote stop receipt onto an already released/expired/failed SSH
 * lease. Used by the continuation gate so a stranded legacy conversation heals
 * once the remote host is proven clean.
 */
export async function persistSshRemoteStopReceipt(
  db: Db,
  lease: StopLease,
  deps: SshRemoteStopDeps = {},
): Promise<boolean> {
  const receipt = await resolveSshRemoteStopReceipt(db, lease, deps);
  if (!receipt) return false;
  const updated = await db
    .update(environmentLeases)
    .set({
      cleanupStatus: "success",
      updatedAt: new Date(),
      metadata: sql`coalesce(${environmentLeases.metadata}, '{}'::jsonb) || ${JSON.stringify({
        remoteExecutionTermination: receipt,
      })}::jsonb`,
    })
    .where(and(
      eq(environmentLeases.id, lease.id),
      eq(environmentLeases.companyId, lease.companyId),
      inArray(environmentLeases.status, ["released", "expired", "failed"]),
    ))
    .returning({ id: environmentLeases.id });
  return updated.length > 0;
}
