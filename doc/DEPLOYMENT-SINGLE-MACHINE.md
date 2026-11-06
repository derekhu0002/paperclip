# Paperclip 单机部署指南（Windows 3 步版）

Status: runbook
Date: 2026-11-06
Audience: 人类执行者（只看第 1 节）+ 被唤起的 OpenCode Agent（读全文）

> **一句话**：仓库只放在 Windows，用你已经装好的 OpenCode；人类做 3 步，剩下由 Agent 自动完成。
> 不需要把仓库放进 WSL/Ubuntu，不需要手工装 Paperclip、Node、Neo4j 或 SSH。

---

## 0. 怎么用这份指南

- **人类**：只读第 1 节，照着做 3 步。看不懂的细节全部跳过。
- **Agent**：读全文，按第 2 节执行。人类没做全的，你补齐；缺依赖自动装；需要人类提供 Key、管理员权限或做取舍时，一次性列清楚再问。
- 所有命令默认在仓库根目录执行；路径不同就替换 `$Repo`。

---

## 1. 人类只需 3 步

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

### 第 2 步：安装 aGraph 并初始化这个仓库

```powershell
npm install -g archgraph-argo
argo-deploy
argo-init
```

说明：

- `argo-deploy` 会把工具链写到 `%USERPROFILE%\.argo`，并给 OpenCode 注册 `argo` MCP。
- **如果 `argo-init` 因为 Neo4j 或 embedding 未就绪而报错，不用处理**，直接做第 3 步。Agent 会检查并补齐。
- 如果本机已有 Neo4j（`127.0.0.1:7687` 能连），保持它运行即可。

### 第 3 步：一条命令唤起 Agent

在仓库根目录执行：

```powershell
opencode run "读取并执行 doc\DEPLOYMENT-SINGLE-MACHINE.md 的 Agent 执行手册：自动检查并安装前置依赖，完成 Paperclip 单机部署、公司/Agent 创建、模型接入和端到端验收；需要我做决定或提供 Key 时，一次性列给我。"
```

然后等 Agent 汇报。它会自己装缺的东西、自己启动 Paperclip、自己验收；只有需要 Key、管理员权限或你确认取舍时才问你。

### 人类不需要做的事

- 不需要把仓库放进 WSL/Ubuntu。
- 不需要手工装 Node、pnpm、Paperclip、PostgreSQL、Neo4j（Agent 会检查并安装）。
- 不需要手工建 SSH 环境（默认不建 Paperclip 项目，见第 5 节）。
- 不需要手工改配置；Agent 会写 `~/.argo/.env`、`~/.paperclip` 和 Paperclip 配置。

---

## 2. Agent 执行手册（人类可跳过）

### 2.0 执行原则

1. **先检查、再安装**；缺什么装什么，不要假设已存在。
2. **只在必要时找人类**：凭据、管理员权限、重启、产品取舍。一次列清，不要反复打断。
3. **不把密钥写入仓库、issue、评论或日志**；只写 `~/.argo/.env`、`~/.paperclip` 或 Paperclip secret。
4. **每阶段有验收**；不通过就修，不要跳到下一阶段。
5. **默认不创建 Paperclip 项目**：用公司级 Agent + 本地执行，直接复用 Windows 上已有的 OpenCode。原因见 5.1。

### 2.1 约定

```powershell
$ErrorActionPreference = 'Stop'
$Repo = (Get-Location).Path
$HealthUrl = 'http://127.0.0.1:3100/api/health'
$Api = 'http://127.0.0.1:3100/api'

function Have($name) { return $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
               [Environment]::GetEnvironmentVariable('Path','User')
}
```

---

## 3. Phase A — 前置检查与自动安装

### 3.1 检查

```powershell
node -v
npm -v
pnpm -v
git --version
rg --version
opencode --version
Test-NetConnection 127.0.0.1 -Port 7687 -InformationLevel Quiet
Get-Command argo-init -ErrorAction SilentlyContinue
```

验收：

| 项 | 要求 |
|---|---|
| Node | `>= v24.11.0` |
| pnpm | `9.x` |
| git / ripgrep / opencode | 命令存在 |
| Neo4j | 7687 可连（不可连也继续，Phase B 处理） |
| aGraph | `argo-init` 存在（不存在则 Phase B 安装） |

### 3.2 自动安装（Windows）

```powershell
# Node（缺少或版本过低时）
winget install --id OpenJS.NodeJS -e --accept-package-agreements --accept-source-agreements
Refresh-Path

# pnpm
npm install -g pnpm@9.15.4

# git / ripgrep（缺少时）
winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
winget install --id BurntSushi.ripgrep.MSVC -e --accept-package-agreements --accept-source-agreements
Refresh-Path

# OpenCode（缺少时；已有就跳过）
npm install -g opencode-ai
```

安装后重新检查一遍。若 `winget` 不存在，改用官方安装包下载；把下载链接和需要人类点的按钮一次性列给人类。

### 3.3 模型可用性

```powershell
opencode models
```

能列出模型即可。后续 Paperclip Agent 的 `adapterConfig.model` 从这个列表里选；优先选你当前 OpenCode 已验证能用的模型。

---

## 4. Phase B — 校验 / 补齐 aGraph

### 4.1 检查安装

```powershell
Test-Path "$env:USERPROFILE\.argo\scripts\argo-mcp-server.js"
Test-Path "$env:USERPROFILE\.argo\.env"
Get-Command argo-init -ErrorAction SilentlyContinue
```

缺任何一项就补装：

```powershell
npm install -g archgraph-argo
argo-deploy
```

> 人类第 2 步通常已经做过。你只做校验和补齐，不要重复初始化图。

### 4.2 确保 Neo4j 可连

```powershell
Test-NetConnection 127.0.0.1 -Port 7687 -InformationLevel Quiet
```

不可连时按顺序尝试：

1. 复用已有 Neo4j（Neo4j Desktop / 本机服务）——让人类启动它。
2. 有 Docker Desktop 时：

```powershell
$Neo4jPass = '<让人类提供或生成一个强密码>'
docker run -d --name argo-neo4j --restart unless-stopped `
  -p 127.0.0.1:7474:7474 -p 127.0.0.1:7687:7687 `
  -e "NEO4J_AUTH=neo4j/$Neo4jPass" `
  -v argo_neo4j_data:/data neo4j:5
```

3. 都没有时：向人类要一次安装授权（Neo4j Desktop 或 Docker Desktop），或让他手工启动现有 Neo4j。

### 4.3 补齐 `%USERPROFILE%\.argo\.env`

只写这些键（其余保持默认；不要把密钥写进仓库）：

```dotenv
ARGO_NEO4J_DATABASE_URL=neo4j://127.0.0.1:7687
ARGO_NEO4J_DATABASE_USERNAME=neo4j
ARGO_NEO4J_DATABASE_PASSWORD=<Neo4j 密码>

# 语义检索需要；没有 embedding 端点就留空，并在最终报告里标注“语义检索未启用”
ARGO_EMBEDDING_PROFILE=openai-compatible
ARGO_EMBEDDING_BASE_URL=<OpenAI 兼容 base URL>
ARGO_EMBEDDING_MODEL=<模型名>
ARGO_EMBEDDING_PROVIDER=<provider 标签>
ARGO_EMBEDDING_MODEL_VERSION=<版本标签>
ARGO_EMBEDDING_DIMENSIONS=1536
QWEN_KEY=<embedding API Key>
```

Embedding 端点可以复用人类现有的模型网关；没有就问一次。没有它时 ARGO 的结构/写入/MCP 仍可用，但 `memory_search` 语义召回会降级。

### 4.4 运行并校验 `argo-init`

```powershell
cd $Repo
argo-init
```

读取 `.argo\temp\argo-harness-init-report.json`，验收：

- 整体 `status: ok`。
- `neo4j.database == paperclip`（仓库目录名；不是就设 `ARGO_NEO4J_DATABASE=paperclip` 后重跑）。
- `qeaFullProjection.qea` 指向 `$Repo\paperclip.qea`（不是就设 `ARGO_EA_QEA=$Repo\paperclip.qea` 后重跑）。
- `semanticLifecycle` 为 `ok`，或明确记录 `skipped/disabled`。

失败就按报告里的 section 修，不要跳过。

### 4.5 确认 OpenCode 能加载 ARGO MCP

```powershell
$cfg = "$env:USERPROFILE\.config\opencode\opencode.json"
Test-Path $cfg
Get-Content $cfg -Raw
```

确认 `mcp.argo` 存在，命令指向 `%USERPROFILE%\.argo\scripts\argo-mcp-server.js`。改过配置后要重启 OpenCode / Paperclip 服务。

---

## 5. Phase C — 安装并启动 Paperclip

### 5.1 安装依赖

```powershell
cd $Repo
pnpm install
```

### 5.2 生成实例配置

```powershell
pnpm paperclipai onboard --yes --no-install-service
```

- 默认 `loopback` + `local_trusted`，本机访问无需登录。
- 如果这个命令在 Windows 上不接受某个参数，去掉它重试；只要求生成配置，不要求安装系统服务。

### 5.3 后台启动

```powershell
$Log = Join-Path $Repo '.paperclip-dev.log'
Start-Process powershell.exe -ArgumentList @(
  '-NoProfile','-Command',"cd '$Repo'; pnpm dev *> '$Log'"
) -WindowStyle Hidden
```

等待健康检查：

```powershell
$deadline = (Get-Date).AddMinutes(5)
do {
  try {
    $h = Invoke-RestMethod $HealthUrl -TimeoutSec 3
    if ($h.status -eq 'ok') { break }
  } catch {}
  Start-Sleep 3
} while ((Get-Date) -lt $deadline)

Invoke-RestMethod $HealthUrl
```

验收：`status: ok`，且 `http://127.0.0.1:3100` 能打开。失败时读 `$Log`，常见原因是 Node 版本、端口 3100 被占用、`pnpm install` 未完成。

---

## 6. Phase D — 创建公司 + Agent

### 6.1 创建公司

```powershell
$Company = Invoke-RestMethod -Method Post -Uri "$Api/companies" -ContentType 'application/json' -Body (@{
  name = 'Paperclip Single Machine'
  description = 'Windows single-machine deployment'
  budgetMonthlyCents = 0
} | ConvertTo-Json)

$CompanyId = $Company.id
$CompanyId
```

### 6.2 解析 OpenCode 可执行文件

```powershell
$OpenCodeExe = Join-Path $env:APPDATA 'npm\node_modules\opencode-ai\bin\opencode.exe'
if (-not (Test-Path $OpenCodeExe)) { $OpenCodeExe = (Get-Command opencode).Source }
$OpenCodeExe
```

优先用 `.exe` 绝对路径，避免 Windows 上 `opencode` shim 解析不到。

### 6.3 选模型

```powershell
opencode models
```

从输出里选一个可用模型，例如 `opencode/deepseek-v4.1-flash-free`（不存在就换列表里的其他项）：

```powershell
$Model = 'opencode/deepseek-v4.1-flash-free'
```

### 6.4 创建 Agent

```powershell
$AgentBody = @{
  name = 'Paperclip Deployer'
  role = 'general'
  adapterType = 'opencode_local'
  adapterConfig = @{
    command = $OpenCodeExe
    cwd = $Repo
    model = $Model
    dangerouslySkipPermissions = $true
    env = @{ ARGO_REPO_ROOT = $Repo }
  }
  runtimeConfig = @{
    heartbeat = @{ enabled = $true; maxConcurrentRuns = 1 }
  }
  budgetMonthlyCents = 0
} | ConvertTo-Json -Depth 12

$Agent = Invoke-RestMethod -Method Post -Uri "$Api/companies/$CompanyId/agents" `
  -ContentType 'application/json' -Body $AgentBody
$Agent.id
```

如果 API 要求 AI connection（返回 `ai_connection_validation_failed` 或类似错误），先做 Phase E，再带上 `runtimeConfig.aiConnection` 重试。

> **不要创建 Paperclip 项目**（默认路径）。本 fork 对项目绑定 Agent 强制要求 SSH 远程环境；公司级 Agent + 本地执行已经够用，而且最省事。若人类明确要项目，见 8.1。

---

## 7. Phase E — 接入模型

优先复用 OpenCode 已有的 provider/auth：

```powershell
opencode run "只回复 OK，不要调用工具。"
```

能正常回复就说明 OpenCode 侧可用。Paperclip 仍可能需要一份公司级 AI connection；需要时向人类要一次 Key，然后：

```powershell
$Key = '<人类提供>'
$ConnBody = @{
  provider = 'openai'
  method = 'api_key'
  name = 'Paperclip OpenAI'
  ownership = 'shared'
  apiKey = $Key
  allAgents = $true
} | ConvertTo-Json

$Conn = Invoke-RestMethod -Method Post -Uri "$Api/companies/$CompanyId/ai-connections" `
  -ContentType 'application/json' -Body $ConnBody
$Conn
```

拿到 `connectionId` / `grantId` 后，在 Agent 的 `runtimeConfig.aiConnection` 里使用：

```json
{
  "mode": "shared",
  "method": "api_key",
  "provider": "openai",
  "connectionId": "<Conn.id>",
  "grantId": "<Conn.grantId>"
}
```

不要猜字段；以创建接口返回和错误提示为准。实在拿不准就让人类在 UI 里点一次 **Agents → New Agent → Connect a model**。

---

## 8. Phase F — 端到端验收（只读）

### 8.1 创建只读验证 issue

```powershell
$IssueBody = @{
  title = 'Verify Windows single-machine deployment'
  description = @'
Read-only. Do not modify files. Report:
1. Get-Location and whether D:\Projects\paperclip is accessible.
2. opencode --version.
3. git rev-parse --abbrev-ref HEAD.
4. Call queryNeo4jGraph {schema:true} and report schemaKind + counts.
5. Call memory_search with "Paperclip deployment" and report whether hits return.
6. Call validateSystemArchitecture and report passed.
Then mark this issue done.
'@
  assigneeAgentId = $Agent.id
  status = 'todo'
} | ConvertTo-Json -Depth 6

$Issue = Invoke-RestMethod -Method Post -Uri "$Api/companies/$CompanyId/issues" `
  -ContentType 'application/json' -Body $IssueBody
$Issue.id
```

### 8.2 验收标准

在 issue 评论或 run 元数据中只接受：

| 检查 | 期望 |
|---|---|
| 工作目录 | `$Repo`（至少能访问；`adapterConfig.cwd` 生效更佳） |
| OpenCode | `opencode --version` 成功 |
| git 分支 | `dev/local-install` |
| `queryNeo4jGraph {schema:true}` | 返回 schema 与元素/关系/视图计数 |
| `memory_search` | 返回命中；若 embedding 未启用，明确记录“降级” |
| `validateSystemArchitecture` | `passed` / `exitCode 0` |

不通过时按顺序排查：

1. `%USERPROFILE%\.config\opencode\opencode.json` 是否有 `mcp.argo`。
2. 手工运行 `node %USERPROFILE%\.argo\scripts\argo-mcp-server.js` 是否报错。
3. Agent 的 `ARGO_REPO_ROOT` 是否等于 `$Repo`。
4. 改完配置后是否重启了 Paperclip 服务。
5. `adapterConfig.command` 是否指向真实的 `opencode.exe`。

---

## 9. Phase G — 交付

向人类输出一页摘要：

```
Paperclip 已启动：http://127.0.0.1:3100
公司：<name> / <CompanyId>
Agent：<name> / <AgentId>
模型：<Model>
aGraph：argo-init status=<ok/其他>；Neo4j=<host:7687>；语义检索=<启用/降级>
验证 issue：<IssueId>，结果=<通过/失败+原因>
需要人类协助：<无 / 具体事项>
```

---

## 10. 验收清单（Agent 完成前逐条确认）

- [ ] Node `>= 24.11`，pnpm `9.x`，git / ripgrep / opencode 可用。
- [ ] `%USERPROFILE%\.argo\scripts\argo-mcp-server.js` 存在。
- [ ] Neo4j `127.0.0.1:7687` 可连。
- [ ] `argo-init` 报告 `status: ok`（或明确记录语义降级原因）。
- [ ] `%USERPROFILE%\.config\opencode\opencode.json` 含 `argo` MCP。
- [ ] `pnpm install` 完成；`/api/health` 返回 `ok`。
- [ ] 公司、Agent 创建成功；Agent 使用 `opencode_local` + 本地执行 + `cwd=$Repo`。
- [ ] 只读验证 issue 通过，ARGO MCP 工具可调用。
- [ ] 交付摘要已给人类。

---

## 11. 常见问题

| 现象 | 处理 |
|---|---|
| `argo-init` 报 Neo4j 连接失败 | 确认 7687；填 `~/.argo/.env`；必要时启动/安装 Neo4j |
| `argo-init` 报数据库名不一致 | 仓库目录名应为 `paperclip`，或设 `ARGO_NEO4J_DATABASE=paperclip` |
| `argo-init` 报 `.qea` 目标不对 | 设 `ARGO_EA_QEA=<Repo>\paperclip.qea` 后重跑 |
| `memory_search` 无结果/超时 | embedding 未配置或维度不对；查 `.env` 与报告；无端点就标注降级 |
| `pnpm dev` 起不来 | 读 `.paperclip-dev.log`；检查 Node 版本、端口 3100、`pnpm install` |
| Paperclip Agent 找不到 opencode | `adapterConfig.command` 改成 `opencode.exe` 绝对路径，重启服务 |
| Paperclip Agent 没有 ARGO 工具 | 检查 `%USERPROFILE%\.config\opencode\opencode.json`；重启 Paperclip |
| `winget` 安装后命令仍找不到 | `Refresh-Path` 或重开终端；仍未生效就直接用安装目录的绝对路径 |
| npm 安装慢/失败 | 配置内网 registry 或代理；把需要人类处理的网络问题一次列出 |
| 端口 3100 被占用 | `Get-NetTCPConnection -LocalPort 3100`；停掉占用进程或换端口 |

---

## 12. 已知限制与取舍

### 12.1 为什么默认不建 Paperclip 项目

本 fork 的 `server/src/fork/project-execution-binding.ts` 规定：**项目绑定的
`opencode_local` Agent 必须开启 `directRemoteWorkspace`，并且执行环境不能是
`local`**。在单机 Windows 上，这会强制你额外搭一套 SSH 执行环境（Windows
OpenSSH + 兼容 POSIX 的 shell），明显增加复杂度。

所以默认采用**公司级 Agent + 本地执行**：不建项目，直接复用 Windows 上已有的
OpenCode，`adapterConfig.cwd` 指向仓库。功能足够跑任务，且人类零额外操作。

如果人类明确需要 Paperclip 项目，再按 12.2 处理。

### 12.2 如果一定要用项目（进阶，Agent 自行判断是否值得）

需要额外满足：

1. 启用 Windows OpenSSH Server（管理员）。
2. 让 SSH 会话落在 POSIX 兼容 shell（Git Bash 或 WSL），否则 Paperclip 的
   `cd` / 路径处理会失败。
3. 创建一个 SSH 环境，`remoteWorkspacePath` 指向仓库（Git Bash 用
   `/d/Projects/paperclip`，WSL 用 `/mnt/d/Projects/paperclip`）。
4. Agent 设置 `directRemoteWorkspace=true`、`defaultEnvironmentId=<SSH 环境>`。
5. 再创建项目并设置 `leadAgentId`。

这套路径可行但步骤多；只有在人类明确要求“必须用项目”时才做，并在做之前把额外
工作量和风险告诉人类。

---

## 13. 附录：关键路径

| 内容 | Windows 路径 |
|---|---|
| 仓库 | `D:\Projects\paperclip`（示例） |
| Paperclip 实例数据 | `%USERPROFILE%\.paperclip\instances\default` |
| Paperclip 健康检查 | `http://127.0.0.1:3100/api/health` |
| Paperclip 日志 | `<Repo>\.paperclip-dev.log` |
| ARGO 根目录 | `%USERPROFILE%\.argo` |
| ARGO 配置 | `%USERPROFILE%\.argo\.env` |
| ARGO MCP | `%USERPROFILE%\.argo\scripts\argo-mcp-server.js` |
| OpenCode 全局配置 | `%USERPROFILE%\.config\opencode\opencode.json` |
| 项目图谱 | `<Repo>\design\KG\SystemArchitecture.json` |
| EA 模型 | `<Repo>\paperclip.qea` |
| argo-init 报告 | `<Repo>\.argo\temp\argo-harness-init-report.json` |
