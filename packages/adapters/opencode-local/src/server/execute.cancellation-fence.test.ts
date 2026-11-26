import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("@paperclipai/adapter-utils/execution-target", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runAdapterExecutionTargetProcess: vi.fn() };
});

import { execute } from "./execute.js";
import { runAdapterExecutionTargetProcess } from "@paperclipai/adapter-utils/execution-target";

const runProcessMock = vi.mocked(runAdapterExecutionTargetProcess);

function succeededResult() {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
  } as never;
}

describe("OpenCode execute pre-dispatch cancellation fence", () => {
  let configHome: string;

  beforeEach(async () => {
    configHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-fence-"));
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    runProcessMock.mockReset();
    runProcessMock.mockResolvedValue(succeededResult());
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(configHome, { recursive: true, force: true });
  });

  it("never invokes the provider when the run is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const onCancellationReady = vi.fn(async () => {});
    const onMeta = vi.fn(async () => {});
    const onSpawn = vi.fn(async () => {});

    const result = await execute({
      runId: "run-cancelled-before-start",
      agent: { id: "agent-1", companyId: "company-1", name: "OpenCode", adapterType: "opencode_local", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: "opencode", cwd: configHome, env: { OPENCODE_ALLOW_ALL_MODELS: "1" } },
      context: { taskId: "task-1", issueId: "issue-1" },
      executionTarget: { kind: "remote", transport: "ssh", remoteCwd: "/srv/workspace" } as never,
      signal: controller.signal,
      onCancellationReady,
      onLog: async () => {},
      onMeta,
      onSpawn,
    });

    expect(onCancellationReady).toHaveBeenCalledTimes(1);
    expect(runProcessMock).not.toHaveBeenCalled();
    expect(onMeta).not.toHaveBeenCalled();
    expect(onSpawn).not.toHaveBeenCalled();
    expect(result.errorCode).toBe("cancelled");
    expect(result.executionRecovery).toEqual({ kind: "bootstrap", providerWorkStarted: false });
  });
});
