import { describe, expect, it } from "vitest";
import {
  buildWindowsRemoteCommand,
  buildWindowsWorkspaceProbeCommand,
  isAbsoluteRemoteWorkspacePath,
  psQuote,
} from "./windows-ssh.js";

describe("isAbsoluteRemoteWorkspacePath", () => {
  it("accepts POSIX, drive-letter and UNC absolute paths", () => {
    expect(isAbsoluteRemoteWorkspacePath("/mnt/d/Projects/graph-wiki")).toBe(true);
    expect(isAbsoluteRemoteWorkspacePath("D:/Projects/graph-wiki")).toBe(true);
    expect(isAbsoluteRemoteWorkspacePath("D:\\Projects\\graph-wiki")).toBe(true);
    expect(isAbsoluteRemoteWorkspacePath("\\\\server\\share\\repo")).toBe(true);
  });

  it("rejects relative and drive-only paths", () => {
    expect(isAbsoluteRemoteWorkspacePath("graph-wiki")).toBe(false);
    expect(isAbsoluteRemoteWorkspacePath("./graph-wiki")).toBe(false);
    expect(isAbsoluteRemoteWorkspacePath("D:")).toBe(false);
    expect(isAbsoluteRemoteWorkspacePath("")).toBe(false);
  });
});

describe("psQuote", () => {
  it("doubles embedded single quotes", () => {
    expect(psQuote("a'b")).toBe("'a''b'");
  });
});

describe("buildWindowsRemoteCommand", () => {
  it("changes directory, prepends PATH and invokes the command", () => {
    const command = buildWindowsRemoteCommand({
      cwd: "D:/Projects/graph-wiki",
      command: "opencode",
      args: ["run", "--dir", "D:/Projects/graph-wiki"],
      env: { ARGO_REPO_ROOT: "D:/Projects/graph-wiki", PATH: "C:\\Users\\me\\AppData\\Roaming\\npm" },
    });
    expect(command.startsWith("powershell -NoProfile -NonInteractive -Command \"")).toBe(true);
    expect(command).toContain("Set-Location -LiteralPath 'D:/Projects/graph-wiki'");
    expect(command).toContain("& 'opencode' 'run' '--dir' 'D:/Projects/graph-wiki'");
    expect(command).toContain("$env:ARGO_REPO_ROOT = 'D:/Projects/graph-wiki'");
    expect(command).toContain("$env:PATH = 'C:\\Users\\me\\AppData\\Roaming\\npm' + ';' + $env:PATH");
    expect(command).toContain("if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }");
  });
});

describe("buildWindowsWorkspaceProbeCommand", () => {
  it("creates the directory when missing and prints the resolved path", () => {
    const command = buildWindowsWorkspaceProbeCommand("D:/Projects/graph-wiki");
    expect(command).toContain("Test-Path -LiteralPath 'D:/Projects/graph-wiki'");
    expect(command).toContain("New-Item -ItemType Directory");
    expect(command).toContain("(Get-Location).Path");
  });
});
