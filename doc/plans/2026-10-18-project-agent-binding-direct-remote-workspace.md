# Project ↔ Agent binding and direct remote workspaces

Date: 2026-10-18
Status: implemented in the fork (`dev/local-install`)

## Goal

1. One project is bound to exactly one agent, and that agent cannot lead another project.
2. A task assigned to that agent runs on the agent's remote execution environment, in the
   project's real directory (no per-run copy).
3. A cwd-derived MCP (ArchGraph/ARGO) resolves the real project directory.
4. No ArchGraph changes and no global environment-variable changes.

## Design

### Binding

`projects.lead_agent_id` is the canonical one-to-one binding. A partial unique index
(`projects_lead_agent_uq`) makes an agent's second project fail at the database level; the
project service returns a 409 before the insert. `POST /companies/:companyId/projects`
requires `leadAgentId`, and issue create/update derives or validates `projectId` from the
assignee's bound project. The project editor (`ProjectProperties`) already round-trips
`leadAgentId`; the create dialog now asks for it.

### Direct remote workspace

`opencode_local` has a new `directRemoteWorkspace` flag. When the target is a remote
environment:

- the run uses the remote environment's `remoteWorkspacePath` (the real project
  checkout; one environment per project);
- `prepareAdapterExecutionTargetRuntime` is called with `syncWorkspace: false` and the
  direct path as `workspaceRemoteDir`, so there is no upload and no sync-back;
- the Paperclip host does not create the directory (it is remote);
- `opencode run --dir <real path>` runs on the execution host;
- `PAPERCLIP_WORKSPACE_CWD` is set to the real path;
- a host-local `instructionsFilePath` is not read by the control plane; OpenCode loads the
  repository's own `AGENTS.md` like the TUI.

Because OpenCode starts in the real checkout, an MCP that resolves its workspace from
`process.cwd()` (the ARGO server's fallback) resolves the real project. No `ARGO_REPO_ROOT`
or global environment change is required.

## Configuration (per project)

1. Create the project and bind its agent: Project → New → select **Bound agent**, or
   `PATCH /api/projects/:id` with `{"leadAgentId":"<agent-id>"}`.
2. Bind that agent to the execution device: Agent → Runtime → Environment override = the
   SSH environment for that project. Use one environment per project/checkout.
3. Set the SSH environment's `remoteWorkspacePath` to the real project checkout on the
   execution host (for example `/mnt/d/Projects/archgraph`). Direct mode runs there.
   Optionally record the same path as a `remote_path` project workspace for display and
   validation:
   ```sh
   npx paperclipai project-workspace create <project-id> --payload-json \
     '{"name":"archgraph","sourceType":"remote_path","cwd":"/mnt/d/Projects/archgraph","isPrimary":true}'
   ```
   `remote_path` workspaces are not stat'ed by the control plane; the adapter validates the
   path on the execution host.
4. Enable direct mode on the agent's adapter config:
   Agent → Configuration → **Direct remote workspace** (or
   `adapterConfig.directRemoteWorkspace: true`).
5. Do not attach a **server-local** `project_workspaces.cwd` to a project that runs on a
   remote host; the control plane cannot stat it and would fail before dispatch.

## MCP / ArchGraph

The execution host needs the same OpenCode global config used by its TUI, including the
ARGO MCP command and provider auth. Paperclip ships a runtime OpenCode config copy to the
host (for `permission=allow` and provider injection); make sure the copied MCP command path
is valid on the execution host. The MCP workspace root comes from the run cwd, so it points
at the real project directory.

Writes must go through the local ARGO MCP. Do not use the remote `graph-mcp` mirror for
writes: it updates the mirror, not the project's `design/KG/SystemArchitecture.json`.

## Verification

- Run metadata shows `cwd` / `--dir` = the real execution-host path.
- `PAPERCLIP_WORKSPACE_CWD` = the same path.
- An agent write appears in the real checkout (`git status` on the execution host).
- The ARGO MCP's `getSystemArchitecture` / `queryNeo4jGraph` sees the project's graph.
- A second project cannot bind the same agent (409).
- A task assigned to the agent without a project gets the agent's project automatically;
  a conflicting explicit project is rejected with 422.

## Known limits

- Direct mode is for trusted, single-writer project checkouts. Concurrent runs in the same
  real directory can collide; keep `maxConcurrentRuns` at 1 or use isolated workspaces.
- Remote environments still stage **runtime assets** under
  `<real path>/.paperclip-runtime/opencode`; keep `.paperclip-runtime` out of git.
- `directRemoteWorkspace` is OpenCode-specific. Other adapters keep the existing staging
  behavior.
- On Windows, `pnpm db:generate` / `prune:snapshots` use POSIX shell helpers; generate the
  migration with the underlying `tsc` + `drizzle-kit` commands if the wrapper fails.

## Final operational topology (2026-10-18)

This section records the state reached after live verification. It supersedes the earlier
"no global environment changes" assumption for the WSL execution host.

- Paperclip control plane: 47, source deploy from `/home/paperclip/paperclip-fork`.
- Execution host: WSL distro `ocpc` on the Windows machine; reachable at its Tailscale
  address on SSH port 2222. The agent process runs
  `ssh://root@<wsl-tailscale>:2222//mnt/d/Projects/archgraph :: opencode`.
- Workspace: `/mnt/d/Projects/archgraph` is the real checkout used by the run. It is
  branch `main`, HEAD `4bccf46a0b22e883a4a9f743fb7d88d9c9104af6`, and the only
  `git worktree`; there is no staging copy, fork, or extra worktree for the run.
- OpenCode config: the WSL `opencode` loads `/etc/opencode/opencode.json` in addition to
  its per-run XDG config. That file supplies the global AGENTS rules, global skills under
  `/root/.config/opencode/skills`, the local `argo` MCP, and the remote `graph-mcp`.
  `ripgrep` is installed so the skill tool works. `experimental.mcp_timeout` is 180000 ms.
- ARGO environment: `/root/.argo/.env` is the single source for ARGO settings. The agent's
  `adapterConfig.env` contains only `ARGO_REPO_ROOT`; do not duplicate ARGO variables there.
  `ARGO_ONTOLOGY_PYTHON` in `.env` points at the venv with `rdflib`
  (`/root/.argo/.venv/bin/python3`). The ARGO MCP loads `.env` itself.
- Neo4j for the agent: the **Windows Neo4j Desktop** at `127.0.0.1:7474/7687`. Database
  `archgraph` was verified at 418 elements / 298 relationships / 93 views, matching the
  canonical graph. The WSL side reaches it over a Windows-to-WSL SSH reverse tunnel:
  WSL `127.0.0.1:7474/7687` -> Windows `127.0.0.1:7474/7687`. The launcher is
  `C:\paperclip\neo4j-reverse-tunnel.ps1`; Startup entries
  `neo4j-reverse-tunnel.vbs` and `paperclip-wsl-keepalive.vbs` restart it at logon.
- Neo4j on 47: the shared `argo-neo4j` Docker container (`neo4j:5.26-enterprise`,
  `/opt/argo-neo4j/data`) also serves graph-store sharing. It holds many databases,
  including `paperclip`, `my-army`, `archgraph-agent-*`, and `archgraph-eval`. **Do not
  delete the container or database.** The WSL-to-47 tunnel was disabled; the agent no
  longer uses 47. An earlier `argo-init` run updated 47's `archgraph` database from
  404/91 to 418/93; if the graph store must stay on the older version, leave 47 alone and
  verify its backup/old state before any recovery action.
- Skills: `argo-init`, `ea-human-reconcile`, and `agent-search-diagnosis` are
  human-triggered. Do not require model invocation of them; the project-skill path was
  removed from the global config.
- Verification issues: `ARG-14` (argo-init and projection rebuild), `ARG-15` (session
  visibility), `ARG-16` (post-fix skill/validate/env), `ARG-17` (full ARGO MCP pass:
  semantic `getSystemArchitecture`, `queryNeo4jGraph` 418/298/93, `memory_search` 3 hits,
  `validateSystemArchitecture` passed, `graph_graph_list` 6 assets).
- Remaining risks: the reverse tunnel is a logon Startup item, not a Windows service; the
  Windows Neo4j Desktop and a persistent WSL client must be running. The write-side MCP
  mutation tools were not exercised in the read-only verification; the projection write
  path was exercised by `argo-init`. No ArchGraph source files or branches were changed.
