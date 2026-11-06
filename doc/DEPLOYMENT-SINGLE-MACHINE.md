# Paperclip 单机部署指南（Windows 仓库 + WSL 执行体 · SSH 标准）

Status: runbook
Date: 2026-11-06
Audience: 人类执行者（只看第 1 节）+ 被唤起的 OpenCode Agent（读全文）

> **标准**：所有执行体 Agent 统一通过 Paperclip 的 **SSH 环境**连接；项目绑定的
> `opencode_local` Agent 必须开启 **Direct remote workspace**。不要用 `local`
> 环境跑项目 Agent。
>
> **人类只做 3 步**（都在 Windows 上）：克隆仓库 → 安装 aGraph 并初始化 →
> 一条命令唤起 Agent。仓库只在 Windows；WSL 通过 `/mnt/d/Projects/paperclip`
> 访问同一份仓库，不复制。其余由 Agent 自动完成。

---

## 0. 架构与标准

```text
Windows
├── 仓库 D:\Projects\paperclip（唯一一份，不复制进 WSL）
├── OpenCode（人类已有，用于唤起部署 Agent）
└── aGraph / Neo4j（人类第 2 步安装，供部署 Agent 使用）

WSL Ubuntu（执行体，例如 ocpc）
├── Paperclip 控制台 :3100
├── Paperclip 执行 Agent（OpenCode）
├── aGraph / ARGO（Agent 在 Phase D 安装/校验）
├── Neo4j（复用 Windows 反向隧道，或 WSL Docker）
├── sshd :2222（Paperclip 的 SSH 执行通道）
└── /mnt/d/Projects/paperclip（挂载 Windows 仓库）
```

标准通道：

```text
Paperclip (WSL) --SSH--> 执行体 (WSL/其它机器) --opencode--> 仓库 /mnt/d/Projects/paperclip
```

- Paperclip 侧：SSH 环境 + `remoteWorkspacePath`。
- Agent 侧：`adapterType=opencode_local`、`directRemoteWorkspace=true`、
  `defaultEnvironmentId=<SSH 环境>`。
- 不使用 `local` 环境跑项目绑定的 Agent。

---

## 1. 人类只需 3 步（都在 Windows 上）

### 第 1 步：把分支克隆到 Windows

```powershell
git clone -b dev/local-install https://github.com/derekhu0002/paperclip.git D:\Projects\paperclip
cd D:\Projects\paperclip
```

没有 HTTPS 权限就用你已有的 SSH 方式。最终目录里应有：

```
AGENTS.md
doc\DEPLOYMENT-SINGLE-MACHINE.md
design\KG\SystemArchitecture.json
paperclip.qea
```

### 第 2 步：在 Windows 安装 aGraph 并初始化这个仓库

```powershell
npm install -g archgraph-argo
argo-deploy
argo-init
```

说明：

- 这一步是给“部署 Agent”用的 aGraph；WSL 执行体用的 aGraph 由 Agent 在 Phase D
  自动安装/校验。
- **如果 `argo-init` 因为 Neo4j 或 embedding 未就绪而报错，不用处理**，直接做
  第 3 步。Agent 会检查并补齐。
- 如果本机已有 Neo4j（`127.0.0.1:7687` 能连），保持它运行即可。

### 第 3 步：一条命令唤起 Agent

在 Windows 的仓库根目录执行：

```powershell
opencode run "读取并执行 doc\DEPLOYMENT-SINGLE-MACHINE.md 的 Agent 执行手册：自动检查并安装前置依赖，准备 WSL 执行体，按 SSH 标准完成 Paperclip 控制台、SSH 环境、项目/Agent 创建和端到端验收；需要我做决定或提供 Key 时，一次性列给我。"
```

然后等 Agent 汇报。它会自己装缺的东西、自己准备 WSL、自己启动 Paperclip、自己验收；
只有需要 Key、管理员权限或你确认取舍时才问你。

### 人类不需要做的事

- 不需要把仓库复制进 WSL/Ubuntu；WSL 直接用 `/mnt/d/Projects/paperclip`。
- 不需要手工装 Node、pnpm、Paperclip、PostgreSQL、OpenCode（WSL 侧由 Agent 装）。
- 不需要手工建 SSH 环境（Agent 会建；只有开启 OpenSSH/管理员权限时可能需要你点一下）。
- 不需要手工改配置；Agent 会写 `~/.argo/.env`、`~/.paperclip` 和 Paperclip 配置。

---

## 2. Agent 执行手册（人类可跳过）

### 2.0 执行原则

1. **先检查、再安装**；缺什么装什么，不要假设已存在。
2. **SSH 是标准通道**：项目绑定 Agent 必须 `directRemoteWorkspace=true` +
   SSH 环境；不要用 `local` 绕过。
3. **只在必要时找人类**：凭据、管理员权限、重启、产品取舍。一次列清。
4. **不把密钥写入仓库、issue、评论或日志**；只写 `~/.argo/.env`、`~/.paperclip`
   或 Paperclip secret。
5. **每阶段有验收**；不通过就修，不要跳到下一阶段。
6. **仓库只有一份**：Windows 的 `D:\Projects\paperclip`，WSL 用
   `/mnt/d/Projects/paperclip`，不要在 WSL 再 clone 一份项目仓库。

### 2.1 约定

```powershell
$ErrorActionPreference = 'Stop'
$WinRepo = 'D:\Projects\paperclip'
$WslDistro = 'ocpc'          # 没有就换成已有的 Ubuntu 发行版
$WslRepo = '/mnt/d/Projects/paperclip'
$Api = 'http://127.0.0.1:3100/api'
$HealthUrl = 'http://127.0.0.1:3100/api/health'

function Have($name) { return $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
               [Environment]::GetEnvironmentVariable('Path','User')
}
```

---

## 3. Phase A — Windows 侧前置检查与自动安装

### 3.1 检查

```powershell
node -v
npm -v
pnpm -v
git --version
rg --version
opencode --version
Get-Command argo-init -ErrorAction SilentlyContinue
```

要求：

| 项 | 要求 |
|---|---|
| Node | `>= v24.11.0` |
| pnpm | `9.x` |
| git / ripgrep / opencode | 命令存在 |
| aGraph | `argo-init` 存在（人类第 2 步应已完成） |

### 3.2 自动安装（Windows）

```powershell
winget install --id OpenJS.NodeJS -e --accept-package-agreements --accept-source-agreements
Refresh-Path
npm install -g pnpm@9.15.4
winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
winget install --id BurntSushi.ripgrep.MSVC -e --accept-package-agreements --accept-source-agreements
Refresh-Path
npm install -g opencode-ai
```

没有 `winget` 就下载官方安装包；把需要人类点的按钮和链接一次性列出。

### 3.3 模型可用性（Windows 部署 Agent）

```powershell
opencode models
```

能列出模型即可；部署 Agent 用它做本机判断。

---

## 4. Phase B — 校验 Windows 侧 aGraph

```powershell
Test-Path "$env:USERPROFILE\.argo\scripts\argo-mcp-server.js"
Test-Path "$env:USERPROFILE\.argo\.env"
Get-Command argo-init -ErrorAction SilentlyContinue
```

缺就补：

```powershell
npm install -g archgraph-argo
argo-deploy
```

人类第 2 步可能已经跑过 `argo-init`；你只校验，不要重复建图。Windows 侧 aGraph
只服务于“部署 Agent”，真正执行体的 aGraph 在 Phase D 处理。

---

## 5. Phase C — 准备 WSL 执行体

### 5.1 选择发行版

```powershell
wsl.exe -l -v
```

优先复用已有的 Ubuntu（例如 `ocpc`）。没有就：

```powershell
wsl.exe --install -d Ubuntu
```

设置 `$WslDistro` 为实际名称。确认 systemd：

```powershell
wsl.exe -d $WslDistro -- bash -lc 'systemctl is-system-running || true'
```

不是 `running` 时，在 WSL 内写 `/etc/wsl.conf`：

```ini
[boot]
systemd=true
```

然后 `wsl.exe --shutdown`，重新进入。

### 5.2 安装执行体依赖（WSL）

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y build-essential git curl ca-certificates wget ripgrep \
  openssh-server python3 python3-venv
# Node 24 + pnpm（已有可跳过）
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node -v
npm install -g pnpm@9.15.4
# OpenCode（已有可跳过）
if ! command -v opencode >/dev/null 2>&1; then
  npm install -g opencode-ai
fi
opencode --version
# PowerShell 7（argo-deploy 在 Linux 需要）
if ! command -v pwsh >/dev/null 2>&1; then
  wget -q https://packages.microsoft.com/config/ubuntu/24.04/packages-microsoft-prod.deb \
    -O /tmp/packages-microsoft-prod.deb
  dpkg -i /tmp/packages-microsoft-prod.deb
  apt-get update
  apt-get install -y powershell
fi
pwsh -v
systemctl enable --now ssh || systemctl enable --now sshd
'@
```

> Ubuntu 22.04 把 `24.04` 换成 `22.04`。

### 5.3 确认仓库挂载

```powershell
wsl.exe -d $WslDistro -- bash -lc 'ls -l /mnt/d/Projects/paperclip/AGENTS.md'
wsl.exe -d $WslDistro -- bash -lc 'cd /mnt/d/Projects/paperclip && git rev-parse --abbrev-ref HEAD'
```

预期：文件存在，分支 `dev/local-install`。**不要**在 WSL 里再 clone 一份。

---

## 6. Phase D — WSL 侧 aGraph / ARGO / Neo4j

### 6.1 安装 ARGO 工具链（WSL）

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
set -e
npm install -g archgraph-argo
export PATH="$(npm prefix -g)/bin:$PATH"
argo-deploy
command -v argo-init || echo "argo-init not on PATH; use ~/.argo/bin/argo-init.js"
'@
```

`argo-deploy` 会写 `~/.argo` 和 `~/.config/opencode`。安装后重启 OpenCode。

### 6.2 确保 WSL 内 Neo4j 可连

```powershell
wsl.exe -d $WslDistro -- bash -lc 'ss -lntp | grep -E ":(7687)\b" || true'
wsl.exe -d $WslDistro -- bash -lc 'timeout 3 bash -c "</dev/tcp/127.0.0.1/7687" && echo neo4j-ok || echo neo4j-down'
```

按顺序处理：

1. **复用 Windows Neo4j 的反向隧道**（已知可用）：WSL 的 `127.0.0.1:7687` 由 sshd
   转发到 Windows Neo4j。没有就建立：
   - WSL 内确保 sshd 在 2222（Phase F 会建）。
   - Windows 侧后台运行：
     ```powershell
     Start-Process ssh.exe -ArgumentList @(
       '-N','-R','7687:127.0.0.1:7687','-p','2222','root@127.0.0.1'
     ) -WindowStyle Hidden
     ```
     前提是 Windows 能用免密 key 登录 WSL 的 2222。
2. **WSL Docker**：如果 `docker info` 可用：
   ```bash
   docker run -d --name argo-neo4j --restart unless-stopped \
     -p 127.0.0.1:7474:7474 -p 127.0.0.1:7687:7687 \
     -e "NEO4J_AUTH=neo4j/<强密码>" \
     -v argo_neo4j_data:/data neo4j:5
   ```
3. 都不行：向人类要一次 Neo4j 安装/启动协助。

### 6.3 写 WSL 的 `~/.argo/.env`

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
cat > /root/.argo/.env <<"EOF"
ARGO_NEO4J_DATABASE_URL=neo4j://127.0.0.1:7687
ARGO_NEO4J_DATABASE_USERNAME=neo4j
ARGO_NEO4J_DATABASE_PASSWORD=<密码>

ARGO_EMBEDDING_PROFILE=openai-compatible
ARGO_EMBEDDING_BASE_URL=<OpenAI 兼容 base URL>
ARGO_EMBEDDING_MODEL=<模型名>
ARGO_EMBEDDING_PROVIDER=<provider 标签>
ARGO_EMBEDDING_MODEL_VERSION=<版本标签>
ARGO_EMBEDDING_DIMENSIONS=1536
QWEN_KEY=<embedding API Key>
EOF
chmod 600 /root/.argo/.env
'@
```

没有 embedding 端点就留空对应键，并在最终报告里标注“语义检索降级”。

### 6.4 运行 `argo-init`（WSL，操作 Windows 仓库）

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
cd /mnt/d/Projects/paperclip
export PATH="$(npm prefix -g)/bin:$PATH"
if command -v argo-init >/dev/null 2>&1; then
  argo-init
else
  node /root/.argo/bin/argo-init.js
fi
'@
```

读取 `/mnt/d/Projects/paperclip/.argo/temp/argo-harness-init-report.json`，验收：

- 整体 `status: ok`。
- `neo4j.database == paperclip`（仓库目录名）。
- `qeaFullProjection.qea == /mnt/d/Projects/paperclip/paperclip.qea`。
- `semanticLifecycle` 为 `ok`，或明确记录 `skipped/disabled`。

### 6.5 让执行体 OpenCode 加载 ARGO MCP

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
mkdir -p /etc/opencode
cp /root/.config/opencode/opencode.json /etc/opencode/opencode.json 2>/dev/null || true
cp /root/.config/opencode/AGENTS.md /etc/opencode/AGENTS.md 2>/dev/null || true
grep -n '"argo"' /etc/opencode/opencode.json || true
'@
```

确认 `mcp.argo` 指向 `/root/.argo/scripts/argo-mcp-server.js`。改完重启 OpenCode/Paperclip。

---

## 7. Phase E — 在 WSL 安装并启动 Paperclip 控制台

### 7.1 安装（托管安装，避免在 WSL 再 clone 项目仓库）

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
set -e
export PATH="$(npm prefix -g)/bin:$PATH"
npx --registry https://registry.npmjs.org paperclipai install \
  --repo derekhu0002/paperclip --ref dev/local-install
paperclipai onboard --yes --bind loopback --install-service
paperclipai doctor || true
'@
```

- `--bind loopback`：只本机访问，Windows 通过 WSL 端口转发访问
  `http://127.0.0.1:3100`。
- 如果 `--install-service` 失败（无 systemd/权限），改用 `paperclipai run` 后台运行，
  并记录日志。
- 私有仓库需要 Git 凭据；失败时让人类提供一次，或改用源码路径。

### 7.2 健康检查

```powershell
Invoke-RestMethod $HealthUrl
```

验收：`status: ok`。UI 打开 `http://127.0.0.1:3100`。

---

## 8. Phase F — 建立 SSH 执行环境（标准通道）

### 8.1 WSL sshd 与密钥

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
set -e
systemctl enable --now ssh || systemctl enable --now sshd
mkdir -p /root/.ssh
chmod 700 /root/.ssh
[ -f /root/.ssh/paperclip_env ] || ssh-keygen -t ed25519 -N "" -f /root/.ssh/paperclip_env -C paperclip-exec
grep -qxF "$(cat /root/.ssh/paperclip_env.pub)" /root/.ssh/authorized_keys 2>/dev/null || \
  cat /root/.ssh/paperclip_env.pub >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
ss -lntp | grep -E ":22|:2222" || true
'@
```

如果 22 被占用，用 2222（与现有环境一致）：

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
sed -i "s/^#*Port .*/Port 2222/" /etc/ssh/sshd_config
systemctl restart ssh || systemctl restart sshd
ss -lntp | grep 2222
'@
```

### 8.2 从 WSL 自连验证

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
ssh -i /root/.ssh/paperclip_env -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null -p 2222 root@127.0.0.1 \
  "cd /mnt/d/Projects/paperclip && pwd && git rev-parse --abbrev-ref HEAD"
'@
```

预期：输出 `/mnt/d/Projects/paperclip` 和 `dev/local-install`。

### 8.3 在 Paperclip 创建 SSH 环境

UI：**Company Settings → Instance → Environments → New Environment → SSH**

| 字段 | 值 |
|---|---|
| Name | `WSL Exec · paperclip` |
| Host | `127.0.0.1` |
| Port | `2222`（或实际端口） |
| Username | `root` |
| Remote workspace path | `/mnt/d/Projects/paperclip` |
| Private key | secret，内容为 `/root/.ssh/paperclip_env` |
| Known hosts | 留空 |
| Strict host key checking | 关闭（与现有环境一致） |

点 **Probe**，必须 `ok: true`，`remoteCwd == /mnt/d/Projects/paperclip`。

API 形态：

```http
POST /api/companies/<COMPANY_ID>/environments
Content-Type: application/json

{
  "name": "WSL Exec · paperclip",
  "driver": "ssh",
  "config": {
    "host": "127.0.0.1",
    "port": 2222,
    "username": "root",
    "remoteWorkspacePath": "/mnt/d/Projects/paperclip",
    "privateKey": null,
    "privateKeySecretRef": {
      "type": "secret_ref",
      "secretId": "<company-accessible-secret-id>",
      "version": "latest"
    },
    "knownHosts": null,
    "strictHostKeyChecking": false
  }
}

POST /api/environments/<ENVIRONMENT_ID>/probe
```

---

## 9. Phase G — 创建公司、Agent、项目

### 9.1 公司

```powershell
$Company = Invoke-RestMethod -Method Post -Uri "$Api/companies" -ContentType 'application/json' -Body (@{
  name = 'Paperclip Single Machine'
  description = 'Windows repo + WSL execution (SSH standard)'
  budgetMonthlyCents = 0
} | ConvertTo-Json)
$CompanyId = $Company.id
```

### 9.2 模型与 OpenCode 路径（WSL）

```powershell
wsl.exe -d $WslDistro -- bash -lc 'export PATH="$(npm prefix -g)/bin:$PATH"; opencode models | head -n 30'
wsl.exe -d $WslDistro -- bash -lc 'export PATH="$(npm prefix -g)/bin:$PATH"; command -v opencode'
```

选一个可用模型，记为 `$Model`；记下 `opencode` 绝对路径，记为 `$OpenCodeCmd`。

### 9.3 创建 Agent（SSH 标准）

```powershell
$AgentBody = @{
  name = 'Paperclip Executor'
  role = 'general'
  adapterType = 'opencode_local'
  adapterConfig = @{
    command = $OpenCodeCmd
    model = $Model
    directRemoteWorkspace = $true
    dangerouslySkipPermissions = $true
    env = @{ ARGO_REPO_ROOT = '/mnt/d/Projects/paperclip' }
  }
  defaultEnvironmentId = $EnvironmentId
  runtimeConfig = @{
    heartbeat = @{ enabled = $true; maxConcurrentRuns = 1 }
  }
  budgetMonthlyCents = 0
} | ConvertTo-Json -Depth 12

$Agent = Invoke-RestMethod -Method Post -Uri "$Api/companies/$CompanyId/agents" `
  -ContentType 'application/json' -Body $AgentBody
$Agent.id
```

如果 API 要求 AI connection，先做 9.4，再带上 `runtimeConfig.aiConnection` 重试。

### 9.4 接入模型（按需）

优先复用 OpenCode 已有 provider/auth：

```powershell
wsl.exe -d $WslDistro -- bash -lc 'export PATH="$(npm prefix -g)/bin:$PATH"; opencode run "只回复 OK，不要调用工具。"'
```

Paperclip 需要公司级连接时，向人类要一次 Key：

```powershell
$ConnBody = @{
  provider = 'openai'
  method = 'api_key'
  name = 'Paperclip OpenAI'
  ownership = 'shared'
  apiKey = '<人类提供>'
  allAgents = $true
} | ConvertTo-Json

$Conn = Invoke-RestMethod -Method Post -Uri "$Api/companies/$CompanyId/ai-connections" `
  -ContentType 'application/json' -Body $ConnBody
```

然后把 `runtimeConfig.aiConnection` 设为：

```json
{
  "mode": "shared",
  "method": "api_key",
  "provider": "openai",
  "connectionId": "<Conn.id>",
  "grantId": "<Conn.grantId>"
}
```

### 9.5 创建项目并绑定 Agent

```powershell
$Project = Invoke-RestMethod -Method Post -Uri "$Api/companies/$CompanyId/projects" `
  -ContentType 'application/json' -Body (@{
    name = 'paperclip'
    leadAgentId = $Agent.id
    status = 'planned'
  } | ConvertTo-Json)
$Project.id
```

一个 Agent 只能绑定一个项目。项目绑定后，fork 会强制检查
`directRemoteWorkspace=true` + 非 `local` 环境；本流程已满足。

---

## 10. Phase H — 端到端验收（只读）

```powershell
$IssueBody = @{
  title = 'Verify WSL execution and ARGO MCP via SSH'
  description = @'
Read-only. Do not modify files. Report:
1. pwd and git rev-parse --abbrev-ref HEAD.
2. git worktree list --porcelain.
3. opencode --version.
4. Call queryNeo4jGraph {schema:true}; report schemaKind and counts.
5. Call memory_search with "Paperclip deployment"; report whether hits return.
6. Call validateSystemArchitecture; report passed.
Then mark this issue done.
'@
  projectId = $Project.id
  assigneeAgentId = $Agent.id
  status = 'todo'
} | ConvertTo-Json -Depth 6

$Issue = Invoke-RestMethod -Method Post -Uri "$Api/companies/$CompanyId/issues" `
  -ContentType 'application/json' -Body $IssueBody
$Issue.id
```

只接受：

| 检查 | 期望 |
|---|---|
| `pwd` | `/mnt/d/Projects/paperclip` |
| 分支 | `dev/local-install` |
| worktree | 只有真实 checkout |
| 执行路径 | 通过 SSH 环境执行，非 `runs/<id>/workspace` staging |
| `queryNeo4jGraph {schema:true}` | 返回 schema 与计数 |
| `memory_search` | 返回命中；无 embedding 则明确标注降级 |
| `validateSystemArchitecture` | `passed` / `exitCode 0` |

失败排查顺序：

1. SSH Probe 是否 `ok`，`remoteCwd` 是否正确。
2. Agent 是否 `directRemoteWorkspace=true`，`defaultEnvironmentId` 是否 SSH 环境。
3. `/etc/opencode/opencode.json` 是否有 `mcp.argo`。
4. `ARGO_REPO_ROOT` 是否 `/mnt/d/Projects/paperclip`。
5. 改配置后是否重启 Paperclip。

---

## 11. Phase I — 交付

```
Paperclip：http://127.0.0.1:3100
公司：<name> / <CompanyId>
SSH 环境：WSL Exec · paperclip / <EnvironmentId>（Probe ok）
Agent：<name> / <AgentId>（opencode_local, directRemoteWorkspace=true）
项目：paperclip / <ProjectId>
模型：<Model>
aGraph：argo-init status=<ok/其他>；Neo4j=<host:7687>；语义检索=<启用/降级>
验证 issue：<IssueId>，结果=<通过/失败+原因>
需要人类协助：<无 / 具体事项>
```

---

## 12. 验收清单

- [ ] Windows：Node `>=24.11`、pnpm、git、ripgrep、opencode 可用。
- [ ] Windows：`~/.argo/scripts/argo-mcp-server.js` 存在。
- [ ] WSL：systemd running，Node/pnpm/git/rg/opencode/pwsh 可用。
- [ ] WSL：`/mnt/d/Projects/paperclip` 可访问，分支 `dev/local-install`。
- [ ] WSL：Neo4j `127.0.0.1:7687` 可连。
- [ ] WSL：`argo-init` 报告 `status: ok`（或明确语义降级）。
- [ ] WSL：`/etc/opencode/opencode.json` 含 `argo` MCP。
- [ ] Paperclip `/api/health` = ok。
- [ ] SSH 环境 Probe ok，`remoteCwd=/mnt/d/Projects/paperclip`。
- [ ] Agent：`opencode_local` + `directRemoteWorkspace=true` + SSH 环境。
- [ ] 项目已绑定 `leadAgentId`。
- [ ] 只读验证 issue 通过，ARGO MCP 工具可调用。

---

## 13. 常见问题

| 现象 | 处理 |
|---|---|
| WSL 里 `argo-init` 找不到 | `export PATH="$(npm prefix -g)/bin:$PATH"`，或 `node /root/.argo/bin/argo-init.js` |
| `argo-init` 报 Neo4j 连接失败 | 检查 WSL `127.0.0.1:7687`；建反向隧道或用 WSL Docker 起 Neo4j |
| `argo-init` 报数据库名不一致 | 仓库目录名应为 `paperclip`，或设 `ARGO_NEO4J_DATABASE=paperclip` |
| `argo-init` 报 `.qea` 目标不对 | 设 `ARGO_EA_QEA=/mnt/d/Projects/paperclip/paperclip.qea` |
| `memory_search` 无结果/超时 | embedding 未配置或维度不对；查 `.env` 与报告 |
| Paperclip 起不来 | `paperclipai doctor` / `paperclipai service logs -f`；检查 Node 版本与端口 |
| SSH Probe 失败 | 检查 2222、root key、`authorized_keys`、`/mnt/d/...` 路径 |
| `project_agent_direct_workspace_required` | 打开 `directRemoteWorkspace` |
| `project_agent_remote_environment_required` | `defaultEnvironmentId` 改 SSH 环境 |
| Agent 没有 ARGO 工具 | 检查 `/etc/opencode/opencode.json` 与 `ARGO_REPO_ROOT`；重启 Paperclip |
| `opencode` 找不到 | Agent 的 `adapterConfig.command` 设为 WSL 内绝对路径 |

---

## 14. 标准与红线

1. **SSH 是唯一执行通道**：项目绑定 Agent 必须走 SSH 环境 + Direct remote workspace。
2. **仓库只有一份**：Windows 的 `D:\Projects\paperclip`；WSL 用 `/mnt/d/...`，不复制。
3. **密钥不进仓库**：只写 `~/.argo/.env`、`~/.paperclip`、Paperclip secret。
4. **每阶段验收**：不通过不进入下一阶段；不伪造 `memory_search` 结果。
5. **不碰外部图**：只用本机/本机 WSL 的 Neo4j，不连 47 共享图。

---

## 15. 附录：关键路径

| 内容 | 路径 |
|---|---|
| Windows 仓库 | `D:\Projects\paperclip` |
| WSL 仓库 | `/mnt/d/Projects/paperclip` |
| Paperclip 实例数据（WSL） | `/root/.paperclip/instances/default` |
| Paperclip 健康检查 | `http://127.0.0.1:3100/api/health` |
| ARGO（WSL） | `/root/.argo` |
| ARGO 配置（WSL） | `/root/.argo/.env` |
| ARGO MCP（WSL） | `/root/.argo/scripts/argo-mcp-server.js` |
| OpenCode 配置（WSL） | `/root/.config/opencode/opencode.json` |
| OpenCode 系统配置（WSL） | `/etc/opencode/opencode.json` |
| 项目图谱 | `/mnt/d/Projects/paperclip/design/KG/SystemArchitecture.json` |
| EA 模型 | `/mnt/d/Projects/paperclip/paperclip.qea` |
| argo-init 报告 | `/mnt/d/Projects/paperclip/.argo/temp/argo-harness-init-report.json` |
