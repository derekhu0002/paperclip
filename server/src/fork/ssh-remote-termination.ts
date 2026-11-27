import { and, eq } from "drizzle-orm";
import { heartbeatRunEvents, heartbeatRuns, type Db } from "@paperclipai/db";
import type { EnvironmentLease } from "@paperclipai/shared";
import { executionStartedEventPredicate } from "../services/pre-dispatch-execution-evidence.js";
import { remoteTerminationReceipt } from "../services/remote-execution-termination.js";

const TERMINAL_RUN_STATUSES: readonly string[] = [
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "interrupted",
];

type SshLeaseIdentity = Pick<
  EnvironmentLease,
  "id" | "companyId" | "heartbeatRunId" | "provider" | "providerLeaseId" | "metadata"
>;

/**
 * Fork helper: decide whether a released SSH lease may be certified `stopped`.
 *
 * An SSH environment is a persistent remote workspace, not a destroyable sandbox
 * (`sharesRemoteWorkspaceInsteadOfSandbox`), so its release path has no provider
 * stop handshake and `hasRemoteTerminationReceipt` can never hold on its own.
 * That strands every continuation behind `remote_cleanup`.
 *
 * The one case the control plane can prove without a provider ack is a legacy
 * run that "never started": it is terminal and recorded no execution-start event
 * (no `adapter.invoke`, process identity, session/turn start, or tool execution),
 * so nothing can be running on the remote host. Native SSH runs keep their own
 * bookkeeping contract and are left untouched. Any execution evidence keeps the
 * lease uncertified, so the existing safety gate (no automatic replay of provider
 * work) stays intact.
 */
export interface SshRunStopEvidence {
  runtimeMode: string | null | undefined;
  runStatus: string | null | undefined;
  hasExecutionStartEvidence: boolean;
}

export function sshRunProvesProviderStopped(evidence: SshRunStopEvidence): boolean {
  return Boolean(
    evidence.runtimeMode === "legacy" &&
      evidence.runStatus &&
      TERMINAL_RUN_STATUSES.includes(evidence.runStatus) &&
      !evidence.hasExecutionStartEvidence,
  );
}

/**
 * Resolve a truthful `stopped` receipt for an SSH lease, or `undefined` when the
 * run cannot be proven to have stopped. Kept in a fork module so the upstream SSH
 * driver carries only one mount point.
 */
export async function resolveSshRemoteTermination(
  db: Db,
  lease: SshLeaseIdentity,
): Promise<Record<string, unknown> | undefined> {
  if (lease.provider !== "ssh" && lease.metadata?.driver !== "ssh") return undefined;
  if (!lease.heartbeatRunId || !lease.providerLeaseId) return undefined;

  // The stop proof is additive. A read failure must never block the release that
  // would otherwise settle the lease, so fail open to the prior behavior.
  let runtimeMode: string | null | undefined;
  let runStatus: string | null | undefined;
  let hasExecutionStartEvidence = true;
  try {
    const [run] = await db
      .select({ id: heartbeatRuns.id, status: heartbeatRuns.status, runtimeMode: heartbeatRuns.runtimeMode })
      .from(heartbeatRuns)
      .where(and(
        eq(heartbeatRuns.id, lease.heartbeatRunId),
        eq(heartbeatRuns.companyId, lease.companyId),
      ));

    const [started] = await db
      .select({ id: heartbeatRunEvents.id })
      .from(heartbeatRunEvents)
      .where(and(
        eq(heartbeatRunEvents.companyId, lease.companyId),
        eq(heartbeatRunEvents.runId, lease.heartbeatRunId),
        executionStartedEventPredicate(),
      ))
      .limit(1);

    runtimeMode = run?.runtimeMode;
    runStatus = run?.status;
    hasExecutionStartEvidence = Boolean(started);
  } catch {
    return undefined;
  }

  if (!sshRunProvesProviderStopped({ runtimeMode, runStatus, hasExecutionStartEvidence })) {
    return undefined;
  }

  return remoteTerminationReceipt(lease, {
    providerLeaseId: lease.providerLeaseId,
    state: "stopped",
  });
}

/**
 * Release options for an SSH lease: attach the certified stop receipt (and the
 * `success` cleanup status the receipt requires) only when the helper proved it.
 */
export function sshReleaseOptions(
  termination: Record<string, unknown> | undefined,
): { cleanupStatus?: "success"; remoteExecutionTermination?: Record<string, unknown> } | undefined {
  return termination ? { cleanupStatus: "success", remoteExecutionTermination: termination } : undefined;
}

/**
 * A released or expired SSH lease can be treated as stopped even when no receipt
 * was stored at release time, but only when the run never produced execution
 * evidence. This is the same proof the release helpers use; it lets a consumer
 * (the explicit-continuation gate) certify a lease an older release path let
 * through without a receipt. A lease that is still pending, or whose run
 * recorded provider work, stays uncertified.
 */
export async function sshReleasedLeaseProvesStopped(
  db: Db,
  lease: SshLeaseIdentity & { status: string; releasedAt: unknown },
): Promise<boolean> {
  if (!lease.releasedAt || !["released", "expired"].includes(lease.status)) return false;
  return (await resolveSshRemoteTermination(db, lease)) !== undefined;
}
