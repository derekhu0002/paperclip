import { describe, expect, it } from "vitest";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { buildOpenCodeLocalConfig } from "./build-config.js";

function baseValues(overrides: Partial<CreateConfigValues> = {}): CreateConfigValues {
  return {
    adapterType: "opencode_local",
    cwd: "/srv/project",
    promptTemplate: "",
    model: "paperclip/deepseek-flash",
    thinkingEffort: "",
    chrome: false,
    dangerouslySkipPermissions: false,
    search: false,
    fastMode: false,
    dangerouslyBypassSandbox: false,
    command: "",
    args: "",
    extraArgs: "",
    envVars: "",
    envBindings: {},
    url: "",
    bootstrapPrompt: "",
    maxTurnsPerRun: 0,
    heartbeatEnabled: false,
    intervalSec: 0,
    ...overrides,
  };
}

describe("buildOpenCodeLocalConfig direct remote workspace", () => {
  it("forwards directRemoteWorkspace so a project agent runs in the real checkout", () => {
    const config = buildOpenCodeLocalConfig(baseValues({ directRemoteWorkspace: true }));
    expect(config.directRemoteWorkspace).toBe(true);
  });

  it("omits directRemoteWorkspace when the operator did not enable it", () => {
    const config = buildOpenCodeLocalConfig(baseValues());
    expect(config).not.toHaveProperty("directRemoteWorkspace");
  });
});
