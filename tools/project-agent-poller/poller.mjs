#!/usr/bin/env node
// Project Agent Poller (B2).
//
// For each registered project this script:
//   1. lists open GitHub issues that carry the project's routing label and
//      are not yet marked "pm:done";
//   2. checks whether the project already has an ACTIVE session, using the
//      OpenCode session database (bias to BUSY: a long tool call or an
//      unfinished assistant turn counts as active);
//   3. also checks Paperclip for queued/running heartbeat runs of the project
//      agent;
//   4. only when there IS unhandled work AND there is NO active session, it
//      creates a carrier Paperclip issue assigned to the project's agent.
//
// The carrier issue body is the task prompt (it becomes the agent's run
// prompt). This script never writes agent instructions or global memory.
//
// Config precedence: CLI --config, POLLER_CONFIG env, ./projects.json.
// Secrets: board token from PAPERCLIP_BOARD_TOKEN (never commit it).
// GitHub: uses the `gh` CLI, which reads GH_TOKEN / GITHUB_TOKEN from env.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- pure helpers (exported for the acceptance test) -------------------------

export function normDir(dir) {
  return String(dir).replace(/\\/g, "/").replace(/\/+$/, "");
}

export function routingLabelFor(project, suffix) {
  return project.routingLabel ?? `${suffix}:${project.project}`;
}

export function filterUnhandled(issues, doneLabel) {
  return issues.filter((issue) => !(issue.labels ?? []).some((label) => label.name === doneLabel));
}

// SQL that returns a row when the project directory has an ACTIVE OpenCode
// session: an unfinished assistant turn OR a running tool part, updated within
// the busy window. Biased to BUSY so a long step is never mistaken for idle.
export function opencodeBusySql(dir, busyWindowMinutes) {
  const normalized = normDir(dir).replace(/'/g, "''");
  const windowMs = busyWindowMinutes * 60 * 1000;
  return [
    "SELECT s.id FROM session s",
    `WHERE lower(replace(s.directory,'\\\\','/')) = lower('${normalized}')`,
    "  AND s.time_archived IS NULL",
    `  AND s.time_updated > (cast(strftime('%s','now') as integer) * 1000 - ${windowMs})`,
    "  AND (",
    "    EXISTS (SELECT 1 FROM message m WHERE m.session_id = s.id",
    "            AND json_extract(m.data,'$.role')='assistant'",
    "            AND json_extract(m.data,'$.time.completed') IS NULL)",
    "    OR EXISTS (SELECT 1 FROM part p WHERE p.session_id = s.id",
    "               AND json_extract(p.data,'$.type')='tool'",
    "               AND json_extract(p.data,'$.state.status')='running')",
    "  )",
    "LIMIT 1",
  ].join("\n");
}

export function buildCarrierIssue(project, issue) {
  const title = `[from:${project.project} -> to:${project.project}] GitHub #${issue.number}: ${issue.title}`;
  const description = [
    `to_project=${project.project}`,
    `from_project=${project.project}`,
    `repo=${project.repo}`,
    `github_issue=#${issue.number} (${issue.url})`,
    "",
    `A new GitHub issue is queued for project "${project.project}".`,
    `Work on exactly this one issue in this project's working directory, then reply on the GitHub issue and finish.`,
    `Do not start another issue in the same session (serial).`,
  ].join("\n");
  return { title, description };
}

// ---- CLI ---------------------------------------------------------------------

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function main() {
  const configPath = resolve(argValue("--config") ?? process.env.POLLER_CONFIG ?? resolve(HERE, "projects.json"));
  if (!existsSync(configPath)) {
    console.error(`[poller] config not found: ${configPath} (copy projects.example.json to projects.json)`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));

  const baseUrl = String(process.env.PAPERCLIP_API_BASE ?? config.paperclipBaseUrl ?? "http://127.0.0.1:3100").replace(/\/+$/, "");
  const token = process.env.PAPERCLIP_BOARD_TOKEN ?? config.boardToken;
  const companyId = config.companyId;
  const busyWindowMinutes = Number(process.env.POLLER_BUSY_WINDOW_MINUTES ?? config.busyWindowMinutes ?? 15);
  const opencodeBin = process.env.OPENCODE_BIN ?? config.opencodeBin ?? "opencode";
  const opencodeCommand =
    process.platform === "win32" && !/\.[a-z0-9]+$/i.test(opencodeBin) ? `${opencodeBin}.cmd` : opencodeBin;
  const routingLabelSuffix = config.routingLabelSuffix ?? "pm";
  const doneLabel = config.doneLabel ?? "pm:done";

  const logFile = config.logFile ? resolve(isAbsolute(config.logFile) ? config.logFile : resolve(HERE, config.logFile)) : null;
  if (logFile) mkdirSync(dirname(logFile), { recursive: true });
  const log = (message) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    console.log(line);
    if (logFile) { try { appendFileSync(logFile, line + "\n"); } catch { /* ignore */ } }
  };

  if (!token) { console.error("[poller] missing board token: set PAPERCLIP_BOARD_TOKEN"); process.exit(1); }
  if (!companyId) { console.error("[poller] missing companyId in config"); process.exit(1); }

  const listUnhandledIssues = (project) =>
    filterUnhandled(
      JSON.parse(
        run("gh", [
          "issue", "list",
          "--repo", project.repo,
          "--state", "open",
          "--label", routingLabelFor(project, routingLabelSuffix),
          "--json", "number,title,url,labels",
          "--limit", "50",
        ]) || "[]",
      ),
      doneLabel,
    );

  const opencodeBusy = (project) => {
    try {
      const out = run(opencodeCommand, ["db", opencodeBusySql(project.dir, busyWindowMinutes)]);
      return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length > 1; // header + >=1 row
    } catch (error) {
      log(`  opencode db check failed (${error.message}); treating as BUSY (safe default).`);
      return true;
    }
  };

  const paperclipBusy = async (project) => {
    const url = `${baseUrl}/api/companies/${companyId}/heartbeat-runs?agentId=${encodeURIComponent(project.agentId)}&limit=20`;
    let res;
    try { res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }); }
    catch (error) { log(`  paperclip runs check failed (${error.message}); treating as BUSY (safe default).`); return true; }
    if (!res.ok) { log(`  paperclip runs check HTTP ${res.status}; treating as BUSY (safe default).`); return true; }
    const body = await res.json();
    const runs = Array.isArray(body) ? body : (body.runs ?? body.items ?? []);
    return runs.some((entry) => entry.status === "queued" || entry.status === "running");
  };

  const createCarrier = async (project, issue) => {
    const payload = buildCarrierIssue(project, issue);
    const res = await fetch(`${baseUrl}/api/companies/${companyId}/issues`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...payload, status: "todo", priority: "medium", projectId: project.projectId, assigneeAgentId: project.agentId }),
    });
    if (!res.ok) { log(`  carrier create failed HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`); return false; }
    const created = await res.json().catch(() => null);
    log(`  carrier issue created: ${created?.id ?? created?.issue?.id ?? "(unknown id)"}`);
    return true;
  };

  const projects = config.projects ?? [];
  if (projects.length === 0) { log("no projects configured"); return; }
  for (const project of projects) {
    log(`project=${project.project} repo=${project.repo} dir=${project.dir}`);
    let issues;
    try { issues = listUnhandledIssues(project); }
    catch (error) { log(`  gh issue list failed: ${error.message}`); continue; }
    if (issues.length === 0) { log("  no unhandled issues"); continue; }
    log(`  unhandled: ${issues.map((issue) => `#${issue.number}`).join(", ")}`);

    if (opencodeBusy(project)) { log("  BUSY (opencode session active) -> skip"); continue; }
    if (await paperclipBusy(project)) { log("  BUSY (paperclip run active) -> skip"); continue; }

    const issue = issues[0];
    log(`  idle -> triggering carrier for #${issue.number}`);
    await createCarrier(project, issue);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
