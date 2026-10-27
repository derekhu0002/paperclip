import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, lstat, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildOpenCodeAgentHomeScript,
  resolveOpenCodeAgentHome,
} from "./skills.js";

const execFileAsync = promisify(execFile);
const itLinux = process.platform === "linux" ? it : it.skip;

describe("OpenCode per-agent home (Linux shell)", () => {
  itLinux("isolates Paperclip skills while preserving the native user surface", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-agent-home-"));
    try {
      const base = path.join(root, "base");
      const assetA = path.join(root, "asset-a");
      const assetB = path.join(root, "asset-b");
      await mkdir(path.join(base, ".config/opencode"), { recursive: true });
      await mkdir(path.join(base, ".claude/skills/ambient-only"), { recursive: true });
      await mkdir(path.join(base, ".claude/skills/paperclip-old"), { recursive: true });
      await mkdir(path.join(base, ".agents/skills/agent-skill"), { recursive: true });
      await mkdir(path.join(assetA, "a-skill"), { recursive: true });
      await mkdir(path.join(assetA, "user-skill"), { recursive: true });
      await mkdir(path.join(assetB, "b-skill"), { recursive: true });
      await writeFile(path.join(base, ".config/opencode/opencode.json"), '{"mcp":{"demo":{}}}');
      await writeFile(path.join(base, ".claude/CLAUDE.md"), "# claude");
      await writeFile(path.join(base, ".claude/skills/ambient-only/SKILL.md"), "# ambient");
      await writeFile(path.join(base, ".claude/skills/paperclip-old/SKILL.md"), "# old");
      await writeFile(path.join(base, ".agents/skills/agent-skill/SKILL.md"), "# agent");
      await writeFile(path.join(base, ".gitconfig"), "[user]\n");
      await writeFile(path.join(assetA, "a-skill/SKILL.md"), "# a");
      await writeFile(path.join(assetA, "user-skill/SKILL.md"), "# paperclip wins");
      await writeFile(path.join(assetB, "b-skill/SKILL.md"), "# b");

      const paperclipSkillNames = ["a-skill", "paperclip-old", "user-skill"];
      for (const [agentId, asset] of [
        ["agent-a", assetA],
        ["agent-b", assetB],
      ] as const) {
        const agentHome = resolveOpenCodeAgentHome(base, agentId);
        const scriptPath = path.join(root, `${agentId}.sh`);
        await writeFile(
          scriptPath,
          buildOpenCodeAgentHomeScript({
            baseHome: base,
            agentHome,
            skillsAssetDir: asset,
            paperclipSkillNames,
          }),
          "utf8",
        );
        await execFileAsync("bash", [scriptPath]);
      }

      const a = resolveOpenCodeAgentHome(base, "agent-a");
      const b = resolveOpenCodeAgentHome(base, "agent-b");
      expect(await readFile(path.join(a, ".claude/skills/a-skill/SKILL.md"), "utf8")).toBe("# a");
      expect(await readFile(path.join(a, ".claude/skills/user-skill/SKILL.md"), "utf8")).toBe(
        "# paperclip wins",
      );
      expect((await lstat(path.join(a, ".claude/skills/ambient-only"))).isSymbolicLink()).toBe(true);
      expect(await readFile(path.join(a, ".config/opencode/opencode.json"), "utf8")).toContain(
        "demo",
      );
      expect((await lstat(path.join(a, ".claude/CLAUDE.md"))).isSymbolicLink()).toBe(true);
      expect((await lstat(path.join(a, ".agents"))).isSymbolicLink()).toBe(true);
      expect((await lstat(path.join(a, ".gitconfig"))).isSymbolicLink()).toBe(true);
      await expect(lstat(path.join(a, ".claude/skills/paperclip-old"))).rejects.toThrow();
      await expect(lstat(path.join(b, ".claude/skills/a-skill"))).rejects.toThrow();
      expect(await readFile(path.join(b, ".claude/skills/b-skill/SKILL.md"), "utf8")).toBe("# b");
      expect((await lstat(path.join(b, ".claude/skills/ambient-only"))).isSymbolicLink()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
