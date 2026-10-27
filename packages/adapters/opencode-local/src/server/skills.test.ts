import { describe, expect, it } from "vitest";
import {
  buildOpenCodeAgentHomeScript,
  resolveOpenCodeAgentHome,
} from "./skills.js";

describe("OpenCode per-agent home", () => {
  it("uses a stable home per agent without changing the shared checkout", () => {
    const first = resolveOpenCodeAgentHome("/home/agent", "agent-1");
    const second = resolveOpenCodeAgentHome("/home/agent", "agent-2");
    expect(first).toBe("/home/agent/.paperclip/agents/agent-1/home");
    expect(second).toBe("/home/agent/.paperclip/agents/agent-2/home");
    expect(first).not.toBe(second);
  });

  it("links the native user surface but rebuilds only .claude/skills", () => {
    const script = buildOpenCodeAgentHomeScript({
      baseHome: "/home/agent",
      agentHome: "/home/agent/.paperclip/agents/agent-1/home",
      skillsAssetDir: "/remote/run/skills",
      paperclipSkillNames: ["paperclip", "complain", "paperclip"],
    });

    expect(script).toContain("BASE_HOME='/home/agent'");
    expect(script).toContain(
      "AGENT_HOME='/home/agent/.paperclip/agents/agent-1/home'",
    );
    expect(script).toContain("SKILLS_ASSET='/remote/run/skills'");
    expect(script).toContain("PAPERCLIP_SKILL_NAMES='complain paperclip'");
    expect(script).toContain('rm -rf "$AGENT_HOME/.claude"');
    expect(script).toContain('case "$name" in .claude|.paperclip) continue;; esac');
    expect(script).toContain(
      'cp -a "$SKILLS_ASSET"/. "$AGENT_HOME/.claude/skills"/',
    );
    expect(script).toContain(
      'case " $PAPERCLIP_SKILL_NAMES " in *" $name "*) continue;; esac',
    );
    expect(script).toContain(
      'mkdir -p "$AGENT_HOME/.config" "$AGENT_HOME/.local/share"',
    );
  });

  it("shell-quotes paths containing single quotes", () => {
    const script = buildOpenCodeAgentHomeScript({
      baseHome: "/home/o'hara",
      agentHome: "/home/o'hara/.paperclip/agents/agent-1/home",
      skillsAssetDir: null,
      paperclipSkillNames: [],
    });
    expect(script).toContain("BASE_HOME='/home/o'\\''hara'");
    expect(script).toContain("SKILLS_ASSET=''");
  });
});
