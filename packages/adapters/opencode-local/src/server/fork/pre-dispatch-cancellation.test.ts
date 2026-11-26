import { describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import type { AdapterExecutionTarget } from "@paperclipai/adapter-utils/execution-target";
import { fencePreDispatchCancellation } from "./pre-dispatch-cancellation.js";

const remoteTarget = { kind: "remote", transport: "ssh", remoteCwd: "/srv/workspace" } as unknown as AdapterExecutionTarget;

function context(overrides: Partial<AdapterExecutionContext> = {}): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: { id: "agent-1", companyId: "company-1", name: "OpenCode", adapterType: "opencode_local", adapterConfig: {} },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: {},
    context: {},
    onLog: async () => {},
    executionTarget: remoteTarget,
    ...overrides,
  } as AdapterExecutionContext;
}

describe("fencePreDispatchCancellation", () => {
  it("settles a cancelled remote run as bootstrap without starting provider work", async () => {
    const controller = new AbortController();
    const onCancellationReady = vi.fn(async () => controller.abort());

    const fence = await fencePreDispatchCancellation(context({ signal: controller.signal, onCancellationReady }));

    expect(onCancellationReady).toHaveBeenCalledTimes(1);
    expect(fence.cancelled).toBe(true);
    if (!fence.cancelled) throw new Error("expected a cancelled fence");
    expect(fence.result.errorCode).toBe("cancelled");
    expect(fence.result.exitCode).toBeNull();
    expect(fence.result.executionRecovery).toEqual({ kind: "bootstrap", providerWorkStarted: false });
  });

  it("lets a remote run continue when the cancellation check leaves it running", async () => {
    const controller = new AbortController();
    const onCancellationReady = vi.fn(async () => {});

    const fence = await fencePreDispatchCancellation(context({ signal: controller.signal, onCancellationReady }));

    expect(onCancellationReady).toHaveBeenCalledTimes(1);
    expect(fence).toEqual({ cancelled: false });
  });

  it("releases an aborted sandbox through the host-owned stop before settling", async () => {
    const controller = new AbortController();
    const stopRemoteStartup = vi.fn(async () => {});
    const fence = await fencePreDispatchCancellation(context({
      signal: controller.signal,
      executionTarget: { kind: "remote", transport: "sandbox" } as unknown as AdapterExecutionTarget,
      onCancellationReady: async () => controller.abort(),
      stopRemoteStartup,
    }));

    expect(stopRemoteStartup).toHaveBeenCalledTimes(1);
    expect(fence.cancelled).toBe(true);
  });

  it("leaves local runs untouched", async () => {
    const controller = new AbortController();
    controller.abort();
    const onCancellationReady = vi.fn(async () => {});

    const fence = await fencePreDispatchCancellation(context({
      signal: controller.signal,
      executionTarget: { kind: "local" } as unknown as AdapterExecutionTarget,
      onCancellationReady,
    }));

    expect(onCancellationReady).not.toHaveBeenCalled();
    expect(fence).toEqual({ cancelled: false });
  });

  it("does nothing without an abort signal", async () => {
    const onCancellationReady = vi.fn(async () => {});

    const fence = await fencePreDispatchCancellation(context({ onCancellationReady }));

    expect(onCancellationReady).not.toHaveBeenCalled();
    expect(fence).toEqual({ cancelled: false });
  });
});
