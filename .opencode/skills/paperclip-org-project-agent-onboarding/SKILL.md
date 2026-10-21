---
name: paperclip-org-project-agent-onboarding
description: "Create a Paperclip organization and a one-to-one project+agent pair that runs in the real WSL checkout and can use the ArchGraph/ARGO MCP. Use when adding an organization, onboarding a repo, hiring a project agent, or fixing a project-bound agent that runs locally or loses the ARGO workspace. Keywords: organization, project, agent, WSL, execution host, ARGO, ArchGraph, direct remote workspace, environment, 新建组织, 新增项目, 绑定 Agent, WSL 执行机."
---

# Paperclip organization -> project + agent on WSL

This is an operator skill for an OpenCode session opened in the Paperclip repo. It
creates an organization and **one** project + **one** bound agent that executes in
the real WSL checkout with the ArchGraph/ARGO MCP available.

It does not change ArchGraph source, does not run the three human-triggered ARGO
skills, and does not touch the 47 Neo4j.

## Definition of done

- A new organization exists.
- One SSH environment points at the project's real WSL directory and probes OK.
- One `opencode_local` agent uses that environment, has direct remote workspace
  enabled, and has a working AI connection.
- One project has `leadAgentId` set to that agent; no other project uses it.
- A read-only issue assigned to the agent runs on WSL in the real directory, on
  the current branch, with no staged workspace.
- ARGO MCP `queryNeo4jGraph`, semantic `getSystemArchitecture`, `memory_search`,
  `validateSystemArchitecture`, and `graph-mcp` all respond successfully.
- 47 Neo4j is untouched; the branch was not switched; no secrets were written to
  the repo, an issue, or this skill.

## Quick path

1. Create the organization (`POST /api/companies`).
2. Verify the real WSL checkout and create one SSH environment for its path;
   probe it.
3. If the repo has no ARGO graph, ask the human to run `argo-init` in WSL; do not
   auto-run it.
4. Hire one `opencode_local` agent on that environment with direct remote
   workspace and `ARGO_REPO_ROOT`; connect the new company's AI model.
5. Create one project with `leadAgentId` set to that agent.
6. Run one read-only issue and verify cwd, branch, no staging, and all ARGO MCP
   paths; then declare done.

## 0. Preconditions and known-good reference

Check these before creating anything:

- Paperclip control plane is reachable and you have board access. Use an existing
  board session or a board API key. Never ask for a token or key in an issue
  comment.
- The execution host is the WSL distro `ocpc`; the current known-good SSH target
  is the WSL Tailscale address on port 2222, user `root`.
- The WSL checkout exists, is the current branch, and is not a throwaway worktree.
- The Windows Neo4j Desktop is running and the WSL-to-Windows reverse tunnel is
  active. `/root/.argo/.env` is the ARGO configuration source.
- The execution host's OpenCode loads `/etc/opencode/opencode.json`; it provides
  the global AGENTS rules, the `argo` and `graph-mcp` MCPs, and global skills.
  `ripgrep` is installed and `experimental.mcp_timeout` is at least 120000 ms.
- The known-good reference is organization `argo`, project `archgraph`, agent
  `项目经理 · archgraph`, and SSH environment `WSL2 · archgraph`. Use the
  environment as a template for host/port/user/key handling, not as the new
  project's path.

If the instance is Paperclip Cloud-managed, in-app organization creation is a
403 floor. Create the organization in Paperclip Cloud and continue with the
project/agent setup here.

## 1. Create the organization

Preferred API path (local instance, board actor):

```http
POST /api/companies
Content-Type: application/json

{"name": "<organization name>", "description": "<optional>", "budgetMonthlyCents": 0}
```

The response contains `id` (company id) and `issuePrefix`.

UI alternative: **Organizations -> New Organization -> name -> create**. The
onboarding wizard creates the company at its first step. If it then proceeds to
hire an agent/project, either use that pair as the pair or close the wizard after
the company exists; do not create a second unbound agent by accident.

Record `COMPANY_ID` and use it for every step below.

## 2. Prepare the WSL execution environment

First verify the real checkout (read-only):

```sh
ssh root@<wsl-tailscale-ip> -p 2222 \
  'cd /mnt/d/Projects/<repo> && pwd && git rev-parse --abbrev-ref HEAD && git worktree list --porcelain'
```

The output must be the real repository root, the current branch, and exactly one
worktree. Do not create a worktree, fork, or alternate checkout for Paperclip.
If the directory is missing, clone/checkout the project on WSL first.

Create one SSH environment per project path. The environment is instance-scoped;
the private-key secret is company-scoped, so do not assume another company's
secret is usable.

UI: **Company Settings -> Instance -> Environments -> New Environment**, select
**SSH**, and fill:

- Name: `WSL2 · <repo>`
- Host: the current WSL Tailscale address (use the existing `WSL2 · archgraph`
  environment as the source of truth if you are unsure)
- Port: `2222`
- Username: `root`
- Remote workspace path: `/mnt/d/Projects/<repo>` (absolute; the real checkout)
- Private key: choose a key secret the new company can access. Reuse the existing
  WSL key only if that secret is accessible to the new company; otherwise create a
  company secret from the operator's key. Never paste the key into an issue.
- Known hosts: empty; strict host key checking: off, matching the existing setup.

Save and click **Probe**. It must return `ok: true` with `remoteCwd` equal to the
remote path.

API shape:

```http
POST /api/companies/<COMPANY_ID>/environments
Content-Type: application/json

{
  "name": "WSL2 · <repo>",
  "driver": "ssh",
  "config": {
    "host": "<wsl-tailscale-ip>",
    "port": 2222,
    "username": "root",
    "remoteWorkspacePath": "/mnt/d/Projects/<repo>",
    "privateKey": null,
    "privateKeySecretRef": {
      "type": "secret_ref",
      "secretId": "<secret the new company can access>",
      "version": "latest"
    },
    "knownHosts": null,
    "strictHostKeyChecking": false
  }
}
```

Then:

```http
POST /api/environments/<ENVIRONMENT_ID>/probe
```

If the environment create rejects the secret, create/select a company secret in
the UI and retry. Do not inline the private key in the skill or a comment.

## 3. ARGO readiness gate (human-triggered)

The project must have a usable ARGO graph before the first verification task.
This is a human/operator step; do not have the agent auto-run the three
human-triggered ARGO skills.

- If the repository already has `design/KG/SystemArchitecture.json` and a
  matching Neo4j projection, verify it and skip initialization.
- If it is a new project, ask the human to run the `argo-init` skill/CLI in the
  WSL execution host for this repository. It uses `/root/.argo/.env` and the
  Windows Neo4j; it must report an overall `ok`, the Neo4j database name equal to
  the repo basename, and the `.qea` target equal to the repo's own `.qea`.
- Do not run init against 47 Neo4j. 47 is the shared graph-store source and must
  be left alone.
- Do not initialize from a throwaway branch/worktree. Use the real checkout.

If ARGO init is not possible, stop before assigning tasks and report the blocker.

## 4. Create the agent

### AI connection preflight

The new company needs its own working AI connection. The easiest path is the
Paperclip UI: **Agents -> New Agent -> Connect a model** (API key or subscription);
that creates the company-scoped connection. If you use the API, the human must
provide the credential through the secure path, and you can create the connection
with `POST /api/companies/<COMPANY_ID>/ai-connections`. Never copy a
`connectionId`/`grantId` from another company and never put an API key in an
issue, the skill, or the repo.

If the company has no AI connection, stop and ask the human to connect one. Do
not create an agent with a guessed binding.

### UI path

**Agents -> New Agent**, then:

- Choose **OpenCode**.
- Model: `paperclip/deepseek-flash` (or another model the operator approved).
- Connect the model for this company.
- Runtime -> **Environment override**: the `WSL2 · <repo>` environment.
- Adapter -> **Direct remote workspace**: on.
- Environment variables: add `ARGO_REPO_ROOT=/mnt/d/Projects/<repo>`. Do not add
  other ARGO variables; `/root/.argo/.env` is the single source.
- Save and run **Test** with the WSL environment. It must pass and report the
  remote checkout.

### API path

```http
POST /api/companies/<COMPANY_ID>/agents
Content-Type: application/json

{
  "name": "<agent name>",
  "role": "general",
  "adapterType": "opencode_local",
  "adapterConfig": {
    "model": "paperclip/deepseek-flash",
    "directRemoteWorkspace": true,
    "dangerouslySkipPermissions": true,
    "env": {
      "ARGO_REPO_ROOT": "/mnt/d/Projects/<repo>"
    }
  },
  "defaultEnvironmentId": "<ENVIRONMENT_ID>",
  "runtimeConfig": {
    "heartbeat": {
      "enabled": true,
      "maxConcurrentRuns": 1
    },
    "aiConnection": {
      "mode": "shared",
      "method": "api_key",
      "provider": "openai",
      "connectionId": "<company AI connection id>",
      "grantId": "<company grant id>"
    }
  },
  "budgetMonthlyCents": 0
}
```

The `aiConnection` shape must match the binding returned by the UI/test for this
company. Do not invent it.

Test the exact saved configuration:

```http
POST /api/companies/<COMPANY_ID>/adapters/opencode_local/test-environment
Content-Type: application/json

{
  "environmentId": "<ENVIRONMENT_ID>",
  "adapterConfig": { "...the saved adapterConfig..." },
  "aiConnection": { "...the company binding..." }
}
```

If it fails with `ai_connection_validation_failed`, fix the AI connection. Do not
bypass validation.

Do not duplicate the global ArchGraph/ARGO rules in the agent's instructions. The
execution host's `/etc/opencode` supplies them; the repository's `AGENTS.md` is
loaded from the real cwd. Add only project-specific instructions if needed.

## 5. Create the project and bind the agent

UI: **Projects -> New Project**, enter the name, select the new agent under
**Bound agent**, optionally attach repositories, and create. Agents already bound
to another project are disabled.

API:

```http
POST /api/companies/<COMPANY_ID>/projects
Content-Type: application/json

{
  "name": "<project name>",
  "leadAgentId": "<AGENT_ID>",
  "status": "planned"
}
```

`leadAgentId` is required; the database enforces one project per agent. A second
binding returns 409. Do not create a second project for the same agent.

Optional display-only workspace:

```http
POST /api/projects/<PROJECT_ID>/workspaces
{"name": "<repo>", "sourceType": "remote_path", "cwd": "/mnt/d/Projects/<repo>", "isPrimary": true}
```

Do not attach a server-local `project_workspaces.cwd`; the control plane cannot
stat it, and direct mode uses the SSH environment's `remoteWorkspacePath`.

## 6. Verify end to end

Create a read-only issue assigned to the agent:

```http
POST /api/companies/<COMPANY_ID>/issues
{"title":"Verify WSL execution and ARGO MCP","description":"Read-only. Do not modify files or run argo-init. Report pwd, current branch, git worktree list, then call queryNeo4jGraph {schema:true}, getSystemArchitecture (semantic), memory_search, validateSystemArchitecture, and graph_graph_list. Mark done.","projectId":"<PROJECT_ID>","assigneeAgentId":"<AGENT_ID>","status":"todo"}
```

Inspect the run metadata/UI and the issue comment. Accept only:

- `cwd` / `--dir` = `/mnt/d/Projects/<repo>`
- command pattern = `ssh://root@<wsl-tailscale-ip>:2222//mnt/d/Projects/<repo> :: opencode`
- no staged `.../runs/<run-id>/workspace`; only runtime assets under
  `.paperclip-runtime`
- `queryNeo4jGraph {schema:true}` returns `schemaKind: workspace`, the workspace
  schema, and the canonical element/relationship/view counts
- semantic `getSystemArchitecture` returns `semanticRetrieval: invoked`
- `memory_search` returns hits and does not time out
- `validateSystemArchitecture` returns `passed` / `exitCode 0`
- `graph_graph_list` returns the expected assets
- `git rev-parse --abbrev-ref HEAD` = the current branch and
  `git worktree list --porcelain` shows only the real checkout

If the run is local, staged, on another branch, or the MCP sees another workspace,
stop and fix the environment/adapter; do not continue with the task.

## 7. API reference

| Purpose | Request |
| --- | --- |
| Create organization | `POST /api/companies` `{name, description?, budgetMonthlyCents?}` |
| List/create environments | `GET/POST /api/companies/:companyId/environments` |
| Probe SSH environment | `POST /api/environments/:id/probe` |
| Create company AI connection | `POST /api/companies/:companyId/ai-connections` (secure credential input) |
| Create agent | `POST /api/companies/:companyId/agents` |
| Test agent environment | `POST /api/companies/:companyId/adapters/opencode_local/test-environment` |
| Create project | `POST /api/companies/:companyId/projects` with `leadAgentId` |
| Create project workspace (optional) | `POST /api/projects/:id/workspaces` with `sourceType: "remote_path"` |
| Create verification issue | `POST /api/companies/:companyId/issues` |

## 8. Failure map

| Symptom | Cause / fix |
| --- | --- |
| 403 creating an organization | Cloud-managed instance; create it in Paperclip Cloud. |
| 422 `A project must be bound to exactly one agent (leadAgentId)` | Include `leadAgentId` in the project create body. |
| 409 on project create | Agent already leads a project; do not create a second. Use the existing project or a new agent. |
| `project_agent_direct_workspace_required` | Enable `adapterConfig.directRemoteWorkspace` on the project-bound agent. |
| `project_agent_remote_environment_required` | Agent is on the local environment; set `defaultEnvironmentId` to the WSL SSH environment. |
| `project_agent_remote_workspace_path_required` | Set the SSH environment's absolute `remoteWorkspacePath`. |
| Environment probe fails | Check host/port/user, key secret access, WSL sshd on 2222, and the real path. |
| `ai_connection_validation_failed` | The new company's AI connection is missing/invalid; fix it in the UI. Do not bypass. |
| ARGO MCP returns empty/stale data | The project's graph is not initialized. Human runs `argo-init` in the real WSL repo; verify DB name == repo basename and `.qea` target. |
| `memory_search` times out | Check the Windows Neo4j reverse tunnel and `experimental.mcp_timeout`; do not point the agent at 47. |
| MCP resolves the wrong workspace | Check `cwd`, `directRemoteWorkspace`, `ARGO_REPO_ROOT`, and the environment `remoteWorkspacePath`. |
| Skill tool reports `ripgrep execution failed` | Install `ripgrep` on the execution host. |
| ARGO validation says `No module named 'rdflib'` | `/root/.argo/.env` must point `ARGO_ONTOLOGY_PYTHON` at the venv with `rdflib`. |

## 9. Guardrails

- Never delete, drop, or rewrite anything on 47 Neo4j. It is the shared graph-store
  source. The execution host uses the Windows Neo4j through the reverse tunnel.
- Do not create a worktree, fork, or alternate checkout. Use the real checkout and
  the current branch.
- Do not use staging mode for a project-bound agent. Direct remote workspace is
  required.
- One project per agent. Do not bind an agent to a second project.
- Do not add ARGO variables to `adapterConfig.env`; only `ARGO_REPO_ROOT` is a
  workspace pin. `/root/.argo/.env` is the single source for ARGO settings.
- Use the local `argo` MCP for graph writes. `graph-mcp` is the remote mirror;
  do not use it for writes.
- Do not run `argo-init`, `ea-human-reconcile`, or `agent-search-diagnosis`
  automatically; they are human-triggered.
- Do not paste credentials, private keys, tokens, or connection secrets into the
  repo, an issue, a comment, or this skill. Use the Paperclip secret picker/API.
- Use a read-only verification task first. Do not mutate the intent graph until
  the execution path and ARGO MCP are proven.
- If the organization is new and has no AI connection, stop and request the human
  connect the model; a skeleton agent that cannot run is not done.
