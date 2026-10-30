import { describe, expect, it } from "vitest";
import {
  buildOpenCodeAgentConfigScript,
  resolveOpenCodeAgentConfigHome,
} from "./skills.js";

describe("OpenCode per-agent config home", () => {
  it("uses a stable config home per agent without touching the user home", () => {
    const first = resolveOpenCodeAgentConfigHome("/home/agent", "agent-1");
    const second = resolveOpenCodeAgentConfigHome("/home/agent", "agent-2");
    expect(first).toBe("/home/agent/.paperclip/agents/agent-1/config");
    expect(second).toBe("/home/agent/.paperclip/agents/agent-2/config");
    expect(first).not.toBe(second);
  });

  it("rebuilds only the per-agent skills dir and links the shared OpenCode config", () => {
    const script = buildOpenCodeAgentConfigScript({
      baseConfigHome: "/home/agent/.config",
      agentConfigHome: "/home/agent/.paperclip/agents/agent-1/config",
      skillsAssetDir: "/remote/run/skills",
    });

    expect(script).toContain("BASE_XDG='/home/agent/.config'");
    expect(script).toContain(
      "AGENT_XDG='/home/agent/.paperclip/agents/agent-1/config'",
    );
    expect(script).toContain("SKILLS_ASSET='/remote/run/skills'");
    expect(script).toContain('rm -rf "$AGENT_XDG/opencode/skills"');
    expect(script).toContain(
      'cp -a "$SKILLS_ASSET"/. "$AGENT_XDG/opencode/skills"/',
    );
    expect(script).toContain('if [ "$name" = "opencode" ]; then continue; fi');
    expect(script).toContain('if [ "$name" = "skills" ]; then continue; fi');
    // The user home, its XDG data/cache/state, and the shared ~/.claude surface
    // are out of scope: a HOME redirect is exactly the bug this script fixes.
    expect(script).not.toContain("HOME");
    expect(script).not.toContain(".claude");
  });

  it("shell-quotes paths containing single quotes", () => {
    const script = buildOpenCodeAgentConfigScript({
      baseConfigHome: "/home/o'hara/.config",
      agentConfigHome: "/home/o'hara/.paperclip/agents/agent-1/config",
      skillsAssetDir: null,
    });
    expect(script).toContain("BASE_XDG='/home/o'\\''hara/.config'");
    expect(script).toContain("SKILLS_ASSET=''");
  });
});
