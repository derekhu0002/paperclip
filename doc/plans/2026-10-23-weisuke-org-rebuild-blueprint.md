# Weisuke organization rebuild blueprint

Date: 2026-10-23

This is a fresh-build blueprint for the intranet Paperclip instance. It intentionally excludes historical issues, approvals, decisions, run history, migration bundles, and the Grok Bot agent.

## Organization

- Display name: Weisuke
- Issue prefix: choose at creation (the current instance uses VSO; do not reuse old IDs)
- Company: create fresh; do not copy old company data

## Project tree

```text
vso-command
├── vso-operations
│   └── vso-dfir
├── vso-exercise
│   └── vso-red
├── vso-detection
├── vso-intel
└── vso-remediation
```

## Projects and repositories

| Project | Parent | Lead agent | Repository |
|---|---|---|---|
| vso-command | root | VSO 指挥官 | `git@github.com:derekhu0002/new-era-cybersecurity-strategy.git` |
| vso-operations | vso-command | 运营经理 | `git@github.com:derekhu0002/vso-operations.git` |
| vso-dfir | vso-operations | DFIR 负责人 | `git@github.com:derekhu0002/vso-dfir.git` |
| vso-exercise | vso-command | 演练总导演 | `git@github.com:derekhu0002/archgraph-agent-purple.git` |
| vso-red | vso-exercise | 红队负责人 | `git@github.com:derekhu0002/archgraph-agent-red.git` |
| vso-detection | vso-command | 检测负责人 | `git@github.com:derekhu0002/archgraph-agent-blue.git` |
| vso-intel | vso-command | 情报负责人 | `git@github.com:derekhu0002/archgraph-agent-intel.git` |
| vso-remediation | vso-command | 加固负责人 | `git@github.com:derekhu0002/archgraph-agent-green.git` |

Each repository is an ArchGraph workspace with `design/KG/SystemArchitecture.json`. Create one SSH environment per project/repository on the intranet execution host. Do not reuse the old host/path values blindly.

## Agents and reporting

All agents use the standard Paperclip heartbeat:

```json
{"enabled":true,"intervalSec":300,"maxConcurrentRuns":1,"skipTimerWhenNoActionableWork":true}
```

| Agent | Project | Reports to | Role/title |
|---|---|---|---|
| VSO 指挥官 | vso-command | none | VSO Commander / SOC Director |
| 运营经理 | vso-operations | VSO 指挥官 | SOC Operations Manager / Incident Commander |
| L1 分诊 | vso-operations | 运营经理 | L1 Alert Triage |
| L2 调查 | vso-operations | 运营经理 | L2 Investigation |
| 处置恢复 | vso-operations | 运营经理 | Containment and Remediation |
| 服务沟通 | vso-operations | 运营经理 | Service Owner and Communications |
| DFIR 负责人 | vso-dfir | 运营经理 | DFIR and Attribution Lead |
| 取证分析师 | vso-dfir | DFIR 负责人 | Digital Forensics Analyst |
| 恶意样本分析师 | vso-dfir | DFIR 负责人 | Malware Analyst |
| 演练总导演 | vso-exercise | VSO 指挥官 | Exercise Director |
| 演练策划 | vso-exercise | 演练总导演 | Exercise Planner |
| 红队负责人 | vso-red | 演练总导演 | Red Cell Lead |
| 红队操作员 | vso-red | 红队负责人 | Red Cell Operator |
| 检测负责人 | vso-detection | VSO 指挥官 | Detection Lead |
| 检测工程师 | vso-detection | 检测负责人 | Detection Engineer |
| 情报负责人 | vso-intel | VSO 指挥官 | Threat Intelligence Lead |
| 情报分析师 | vso-intel | 情报负责人 | Threat Intelligence Analyst |
| 加固负责人 | vso-remediation | VSO 指挥官 | Hardening Lead |
| 加固工程师 | vso-remediation | 加固负责人 | Hardening and Remediation Engineer |

Total: 8 projects, 18 agents. No Grok Bot agent.

## Agent execution profile

- Adapter: `opencode_local`
- Model: `paperclip/deepseek-flash` (or the intranet equivalent)
- `directRemoteWorkspace: true`
- One repository/environment per project
- Use the environment remote path as `ARGO_REPO_ROOT`
- Create a new company AI connection; do not reuse old connection IDs or secrets
- Install OpenCode, git, and ripgrep on the execution host
- Add `.paperclip-runtime/` to the host global gitignore
- Keep one lead agent per project; team agents report to that lead
- An agent belongs to at most one project

## Excluded by request

- Historical issues/comments/documents/work products
- Approvals and decisions
- Migration bundle or database dump
- Grok Bot and its binding/routine

## Acceptance

- 8 projects in the tree above
- 18 agents with the reporting lines above
- Zero unbound agents
- Each project has one lead and one repository/environment
- Each repo has `design/KG/SystemArchitecture.json`
- A projectless smoke task is not needed; use each project's own test task
- Existing Paperclip tasks/history are not restored
