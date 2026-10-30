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
 * A stable per-agent OpenCode config home (the value of `XDG_CONFIG_HOME`).
 *
 * Only OpenCode's own config surface moves: the user's HOME, XDG data/cache/
 * state, and `~/.claude` stay untouched so git, gh, ssh, npm, `~/.argo` and
 * `~/.paperclip` keep resolving the real user home.
 */
export function resolveOpenCodeAgentConfigHome(baseHome: string, agentId: string): string {
  const safeAgentId = agentId.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.posix.join(baseHome, ".paperclip", "agents", safeAgentId, "config");
}

/**
 * Build the per-agent OpenCode config home on the execution host.
 *
 * OpenCode discovers global skills in `$XDG_CONFIG_HOME/opencode/skills`,
 * `~/.claude/skills`, and `~/.agents/skills`. Redirecting only
 * `XDG_CONFIG_HOME` gives each agent a private skills directory without
 * redefining HOME:
 *
 * - every other entry of the shared XDG config dir is linked in, so gh, git
 *   and the OpenCode config (MCP servers, providers, plugins, agents,
 *   commands, instructions) stay discoverable;
 * - the shared `opencode/` entries are linked too, except `skills`;
 * - `opencode/skills` is rebuilt from Paperclip's assignment on every run, so
 *   an agent only ever sees its own skills and stale links cannot survive.
 *
 * Ambient user skills are not copied: they stay visible through the untouched
 * `~/.claude/skills` and `~/.agents/skills` under the real HOME.
 */
export function buildOpenCodeAgentConfigScript(input: {
  baseConfigHome: string;
  agentConfigHome: string;
  skillsAssetDir: string | null;
}): string {
  const baseConfigHome = shellQuote(input.baseConfigHome);
  const agentConfigHome = shellQuote(input.agentConfigHome);
  const skillsAssetDir = shellQuote(input.skillsAssetDir ?? "");

  return [
    "set -e",
    `BASE_XDG=${baseConfigHome}`,
    `AGENT_XDG=${agentConfigHome}`,
    `SKILLS_ASSET=${skillsAssetDir}`,
    'mkdir -p "$AGENT_XDG/opencode/skills"',
    // Keep the user's other XDG config entries (gh, git, ...) reachable.
    'if [ -d "$BASE_XDG" ]; then',
    '  for entry in "$BASE_XDG"/* "$BASE_XDG"/.[!.]*; do',
    '    [ -e "$entry" ] || [ -L "$entry" ] || continue',
    '    name=$(basename "$entry")',
    '    if [ "$name" = "opencode" ]; then continue; fi',
    '    [ -e "$AGENT_XDG/$name" ] || [ -L "$AGENT_XDG/$name" ] || ln -s "$entry" "$AGENT_XDG/$name"',
    "  done",
    "fi",
    // Preserve the shared OpenCode config but keep skills per-agent.
    'if [ -d "$BASE_XDG/opencode" ]; then',
    '  for entry in "$BASE_XDG/opencode"/* "$BASE_XDG/opencode"/.[!.]*; do',
    '    [ -e "$entry" ] || [ -L "$entry" ] || continue',
    '    name=$(basename "$entry")',
    '    if [ "$name" = "skills" ]; then continue; fi',
    '    [ -e "$AGENT_XDG/opencode/$name" ] || [ -L "$AGENT_XDG/opencode/$name" ] || ln -s "$entry" "$AGENT_XDG/opencode/$name"',
    "  done",
    "fi",
    // Rebuild the assignment view so a removed or reassigned skill cannot leak.
    'rm -rf "$AGENT_XDG/opencode/skills"',
    'mkdir -p "$AGENT_XDG/opencode/skills"',
    'if [ -d "$SKILLS_ASSET" ]; then',
    '  cp -a "$SKILLS_ASSET"/. "$AGENT_XDG/opencode/skills"/',
    "fi",
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
