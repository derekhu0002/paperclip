import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";

/**
 * Fork helper: refuse to start a remote OpenCode provider invocation when the run
 * was already cancelled between dispatch and provider startup. Kept outside the
 * upstream `execute` body so the adapter only carries one mount point and
 * upstream merges do not conflict with the fix.
 *
 * Scope is deliberately limited to remote execution targets (SSH and sandbox):
 * that is where a pre-start cancel otherwise leaves the run with provider work
 * recorded and the environment lease stuck in the `remote_cleanup` gate. Local
 * runs keep their existing cancellation semantics untouched.
 *
 * The host installs `onCancellationReady` for every adapter. Calling it publishes
 * this adapter's cancellation control, so an already-terminal run aborts the
 * shared signal; we then settle as a bootstrap cancellation
 * (`providerWorkStarted: false`) without invoking the provider.
 */
export type PreDispatchCancellationFence =
  | { cancelled: true; result: AdapterExecutionResult }
  | { cancelled: false };

function isRemoteExecution(ctx: AdapterExecutionContext): boolean {
  return ctx.executionTarget?.kind === "remote"
    || Boolean(ctx.executionTransport?.remoteExecution);
}

export async function fencePreDispatchCancellation(
  ctx: AdapterExecutionContext,
): Promise<PreDispatchCancellationFence> {
  if (!ctx.signal || !isRemoteExecution(ctx)) return { cancelled: false };
  await ctx.onCancellationReady?.();
  if (!ctx.signal.aborted) return { cancelled: false };
  // A sandbox may have acquired its lease before the adapter registered. Release
  // it through the host-owned stop; SSH serves a persistent workspace and has no
  // sandbox to stop here (its lease is settled by the run teardown).
  if (ctx.stopRemoteStartup) await ctx.stopRemoteStartup();
  return {
    cancelled: true,
    result: {
      exitCode: null,
      signal: null,
      timedOut: false,
      errorCode: "cancelled",
      errorMessage: "OpenCode was cancelled before provider startup.",
      executionRecovery: { kind: "bootstrap", providerWorkStarted: false },
      resultJson: {
        executionCancellation: {
          state: "acknowledged",
          acknowledgedAt: new Date().toISOString(),
        },
      },
    },
  };
}
