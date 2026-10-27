import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterSkillContext,
  AdapterSkillSnapshot,
} from "@paperclipai/adapter-utils";
import {
  buildPersistentSkillSnapshot,
  ensurePaperclipSkillSymlink,
  readPaperclipRuntimeSkillEntries,
  readInstalledSkillTargets,
  resolveLegacyPaperclipDesiredSkillNames,
} from "@paperclipai/adapter-utils/server-utils";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function resolveOpenCodeSkillsHome(config: Record<string, unknown>) {
  const env =
    typeof config.env === "object" && config.env !== null && !Array.isArray(config.env)
      ? (config.env as Record<string, unknown>)
      : {};
  const configuredHome = asString(env.HOME);
  const home = configuredHome ? path.resolve(configuredHome) : os.homedir();
  return path.join(home, ".claude", "skills");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * A stable per-agent OpenCode HOME. The checkout/cwd stays shared; only the
 * user-level OpenCode surface is private to the agent.
 */
export function resolveOpenCodeAgentHome(baseHome: string, agentId: string): string {
  const safeAgentId = agentId.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.posix.join(baseHome, ".paperclip", "agents", safeAgentId, "home");
}

/**
 * Build the per-agent HOME on the execution host.
 *
 * The real user home is symlinked into the agent home so OpenCode keeps its
 * native user-level discovery (config, MCP, instructions, plugins, and the
 * global skill dirs under .config/.agents). Only .claude/skills is rebuilt:
 * Paperclip's desired skills are copied first, then ambient user skills are
 * linked in unless the name is Paperclip-managed or already present. This
 * keeps Paperclip's assignment private without changing the shared checkout.
 */
export function buildOpenCodeAgentHomeScript(input: {
  baseHome: string;
  agentHome: string;
  skillsAssetDir: string | null;
  paperclipSkillNames: string[];
}): string {
  const baseHome = shellQuote(input.baseHome);
  const agentHome = shellQuote(input.agentHome);
  const skillsAssetDir = shellQuote(input.skillsAssetDir ?? "");
  const paperclipSkillNames = shellQuote(
    [...new Set(input.paperclipSkillNames)].sort().join(" "),
  );

  return [
    "set -e",
    `BASE_HOME=${baseHome}`,
    `AGENT_HOME=${agentHome}`,
    `SKILLS_ASSET=${skillsAssetDir}`,
    `PAPERCLIP_SKILL_NAMES=${paperclipSkillNames}`,
    'mkdir -p "$AGENT_HOME"',
    // Rebuild .claude so an older agent home cannot keep a stale symlink to
    // the shared user home and leak one agent's skills into another.
    'rm -rf "$AGENT_HOME/.claude"',
    'mkdir -p "$AGENT_HOME/.claude/skills"',
    // Preserve the native user home for config/MCP/instructions/plugins and
    // the other global skill dirs. .claude is handled separately below.
    'for entry in "$BASE_HOME"/* "$BASE_HOME"/.[!.]*; do',
    '  [ -e "$entry" ] || [ -L "$entry" ] || continue',
    '  name=$(basename "$entry")',
    '  case "$name" in .claude|.paperclip) continue;; esac',
    '  [ -e "$AGENT_HOME/$name" ] || [ -L "$AGENT_HOME/$name" ] || ln -s "$entry" "$AGENT_HOME/$name"',
    "done",
    // Keep user-level .claude files (CLAUDE.md, settings, commands, ...) but
    // replace the shared skills directory with the per-agent merged view.
    'if [ -d "$BASE_HOME/.claude" ]; then',
    '  for entry in "$BASE_HOME/.claude"/* "$BASE_HOME/.claude"/.[!.]*; do',
    '    [ -e "$entry" ] || [ -L "$entry" ] || continue',
    '    name=$(basename "$entry")',
    '    [ "$name" = "skills" ] && continue',
    '    [ -e "$AGENT_HOME/.claude/$name" ] || [ -L "$AGENT_HOME/.claude/$name" ] || ln -s "$entry" "$AGENT_HOME/.claude/$name"',
    "  done",
    "fi",
    // Paperclip wins name conflicts with ambient user skills.
    'if [ -d "$SKILLS_ASSET" ]; then',
    '  cp -a "$SKILLS_ASSET"/. "$AGENT_HOME/.claude/skills"/',
    "fi",
    // Add ambient user skills that are not Paperclip-managed and do not
    // conflict with an assigned Paperclip skill.
    'if [ -d "$BASE_HOME/.claude/skills" ]; then',
    '  for entry in "$BASE_HOME/.claude/skills"/* "$BASE_HOME/.claude/skills"/.[!.]*; do',
    '    [ -e "$entry" ] || [ -L "$entry" ] || continue',
    '    name=$(basename "$entry")',
    '    case " $PAPERCLIP_SKILL_NAMES " in *" $name "*) continue;; esac',
    '    [ -e "$AGENT_HOME/.claude/skills/$name" ] || [ -L "$AGENT_HOME/.claude/skills/$name" ] || ln -s "$entry" "$AGENT_HOME/.claude/skills/$name"',
    "  done",
    "fi",
    'mkdir -p "$AGENT_HOME/.config" "$AGENT_HOME/.local/share" "$AGENT_HOME/.cache" "$AGENT_HOME/.local/state"',
  ].join("\n");
}

async function buildOpenCodeSkillSnapshot(config: Record<string, unknown>): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredSkills = resolveLegacyPaperclipDesiredSkillNames(config, availableEntries);
  const skillsHome = resolveOpenCodeSkillsHome(config);
  const installed = await readInstalledSkillTargets(skillsHome);
  return buildPersistentSkillSnapshot({
    adapterType: "opencode_local",
    availableEntries,
    desiredSkills,
    installed,
    skillsHome,
    locationLabel: "~/.claude/skills",
    installedDetail: "Installed in the shared Claude/OpenCode skills home.",
    missingDetail: "Configured but not currently linked into the shared Claude/OpenCode skills home.",
    externalConflictDetail: "Skill name is occupied by an external installation in the shared skills home.",
    externalDetail: "Installed outside Paperclip management in the shared skills home.",
    warnings: [
      "OpenCode currently uses the shared Claude skills home (~/.claude/skills).",
    ],
  });
}

export async function listOpenCodeSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return buildOpenCodeSkillSnapshot(ctx.config);
}

export async function syncOpenCodeSkills(
  ctx: AdapterSkillContext,
  desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(ctx.config, __moduleDir);
  const desiredSet = new Set([
    ...resolveLegacyPaperclipDesiredSkillNames({}, availableEntries),
    ...desiredSkills,
  ]);
  const skillsHome = resolveOpenCodeSkillsHome(ctx.config);
  await fs.mkdir(skillsHome, { recursive: true });
  const installed = await readInstalledSkillTargets(skillsHome);
  const availableByRuntimeName = new Map(availableEntries.map((entry) => [entry.runtimeName, entry]));

  for (const available of availableEntries) {
    if (!desiredSet.has(available.key)) continue;
    const target = path.join(skillsHome, available.runtimeName);
    await ensurePaperclipSkillSymlink(available.source, target);
  }

  for (const [name, installedEntry] of installed.entries()) {
    const available = availableByRuntimeName.get(name);
    if (!available) continue;
    if (desiredSet.has(available.key)) continue;
    if (installedEntry.targetPath !== available.source) continue;
    await fs.unlink(path.join(skillsHome, name)).catch(() => {});
  }

  return buildOpenCodeSkillSnapshot(ctx.config);
}

export function resolveOpenCodeDesiredSkillNames(
  config: Record<string, unknown>,
  availableEntries: Array<{ key: string }>,
) {
  return resolveLegacyPaperclipDesiredSkillNames(config, availableEntries);
}
