import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, lstat, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildOpenCodeAgentConfigScript,
  resolveOpenCodeAgentConfigHome,
} from "./skills.js";

const execFileAsync = promisify(execFile);
const itLinux = process.platform === "linux" ? it : it.skip;

describe("OpenCode per-agent config home (Linux shell)", () => {
  itLinux("isolates Paperclip skills while preserving the shared user surface", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-agent-config-"));
    try {
      const base = path.join(root, "base");
      const baseConfig = path.join(base, ".config");
      const assetA = path.join(root, "asset-a");
      const assetB = path.join(root, "asset-b");
      await mkdir(path.join(baseConfig, "opencode"), { recursive: true });
      await mkdir(path.join(baseConfig, "gh"), { recursive: true });
      // The user's own skills stay in the shared Claude surface and must never
      // be copied or removed by the per-agent preparation.
      await mkdir(path.join(base, ".claude/skills/ambient-only"), { recursive: true });
      await mkdir(path.join(base, ".agents/skills/agent-skill"), { recursive: true });
      await mkdir(path.join(assetA, "a-skill"), { recursive: true });
      await mkdir(path.join(assetA, "user-skill"), { recursive: true });
      await mkdir(path.join(assetB, "b-skill"), { recursive: true });
      await writeFile(path.join(baseConfig, "opencode/opencode.json"), '{"mcp":{"demo":{}}}');
      await writeFile(path.join(baseConfig, "opencode/AGENTS.md"), "# agents");
      await writeFile(path.join(baseConfig, "gh/hosts.yml"), "github.com:\n");
      await writeFile(path.join(base, ".claude/skills/ambient-only/SKILL.md"), "# ambient");
      await writeFile(path.join(base, ".gitconfig"), "[user]\n");
      await writeFile(path.join(assetA, "a-skill/SKILL.md"), "# a");
      await writeFile(path.join(assetA, "user-skill/SKILL.md"), "# paperclip wins");
      await writeFile(path.join(assetB, "b-skill/SKILL.md"), "# b");

      for (const [agentId, asset] of [
        ["agent-a", assetA],
        ["agent-b", assetB],
      ] as const) {
        const agentConfigHome = resolveOpenCodeAgentConfigHome(base, agentId);
        const scriptPath = path.join(root, `${agentId}.sh`);
        await writeFile(
          scriptPath,
          buildOpenCodeAgentConfigScript({
            baseConfigHome: baseConfig,
            agentConfigHome,
            skillsAssetDir: asset,
          }),
          "utf8",
        );
        await execFileAsync("bash", [scriptPath]);
      }

      const a = resolveOpenCodeAgentConfigHome(base, "agent-a");
      const b = resolveOpenCodeAgentConfigHome(base, "agent-b");
      expect(await readFile(path.join(a, "opencode/skills/a-skill/SKILL.md"), "utf8")).toBe("# a");
      expect(await readFile(path.join(a, "opencode/skills/user-skill/SKILL.md"), "utf8")).toBe(
        "# paperclip wins",
      );
      // Shared OpenCode config and the user's other XDG config entries stay
      // reachable, so MCP/plugins/providers and gh keep working.
      expect(await readFile(path.join(a, "opencode/opencode.json"), "utf8")).toContain("demo");
      expect((await lstat(path.join(a, "opencode/AGENTS.md"))).isSymbolicLink()).toBe(true);
      expect((await lstat(path.join(a, "gh"))).isSymbolicLink()).toBe(true);
      expect(await readFile(path.join(a, "gh/hosts.yml"), "utf8")).toContain("github.com");
      // Each agent only sees its own assignment.
      await expect(lstat(path.join(a, "opencode/skills/paperclip-old"))).rejects.toThrow();
      await expect(lstat(path.join(b, "opencode/skills/a-skill"))).rejects.toThrow();
      expect(await readFile(path.join(b, "opencode/skills/b-skill/SKILL.md"), "utf8")).toBe("# b");
      // The shared user surfaces are untouched.
      expect((await lstat(path.join(base, ".claude/skills/ambient-only"))).isDirectory()).toBe(true);
      expect((await lstat(path.join(base, ".gitconfig"))).isFile()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
