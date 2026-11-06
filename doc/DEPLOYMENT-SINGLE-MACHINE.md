# Paperclip 单机部署指南（镜像部署 · 两步）

Status: runbook
Date: 2026-11-06
Audience: 人类执行者（只看第 1 节）+ 被唤起的 OpenCode Agent（读全文）

> **标准**：Paperclip 控制台从**镜像**部署（先 pull，再 run）；执行体 Agent 统一通过
> Paperclip 的 **SSH 环境**连接，项目绑定 Agent 必须开启 **Direct remote workspace**。
> 仓库只有 Windows 一份，WSL 通过 `/mnt/d/Projects/paperclip` 访问，不复制。
>
> 人类只做两步：**准备环境** → **在 Paperclip 里下指令**。执行器部署由 Agent 完成。

---

## 0. 架构

```text
Windows
├── 仓库 D:\Projects\paperclip（唯一一份）
├── OpenCode TUI（人类在这里唤起部署 Agent）
└── aGraph（人类安装 + 初始化，供部署 Agent 使用）

Docker
└── Paperclip 镜像 → 控制台 :3100（先 pull，再 run）

WSL Ubuntu（执行体）
├── OpenCode（Paperclip 执行 Agent）
├── aGraph / ARGO
├── Neo4j（复用 Windows 反向隧道，或 WSL Docker）
├── sshd :2222（Paperclip SSH 标准通道）
└── /mnt/d/Projects/paperclip（挂载 Windows 仓库）
```

标准通道：

```text
Paperclip 控制台 --SSH--> 执行体（WSL/其它机器） --OpenCode--> 仓库 /mnt/d/Projects/paperclip
```

---

## 1. 人类只做两步

### 第一步：准备环境

#### a. 安装 Docker 和 WSL Ubuntu

- Docker：用于运行 Paperclip 镜像。Windows 上用 Docker Desktop，并开启 WSL 集成。
- WSL Ubuntu：执行体环境（例如 `ocpc`）。

验收：

```powershell
docker version
wsl.exe -l -v
```

#### b. 下载当前分支代码到 Windows

```powershell
git clone -b dev/local-install https://github.com/derekhu0002/paperclip.git D:\Projects\paperclip
cd D:\Projects\paperclip
```

仓库只放 Windows，不要复制进 WSL。

#### c. 安装 aGraph（只安装，不初始化）

```powershell
npm install -g archgraph-argo
argo-deploy
```

#### d. 初始化 aGraph（单独一步）

```powershell
argo-init
```

> `argo-deploy` 和 `argo-init` 必须分开执行：前者安装工具链，后者初始化当前仓库。
> 如果 `argo-init` 因 Neo4j 或 embedding 未就绪报错，不用处理，继续 e；Agent 会补齐。

#### e. 打开 OpenCode TUI，新建会话

```powershell
cd D:\Projects\paperclip
opencode
```

在 TUI 里新建会话，然后发送：

```text
拉取 Paperclip 镜像并启动控制台；完成后告诉我访问地址。镜像地址我会提供。
```

> Agent 会先 `docker pull`，再 `docker run`，最后用 `/api/health` 验证。
> 镜像地址由部署负责人提供；没有就由 Agent 向人类要。

---

### 第二步：在 Paperclip 里下指令

控制台起来后，打开 Paperclip，新建任务 / 指令，指派给 **Paperclip 执行 Agent**：

```text
部署 Paperclip 执行器：准备 WSL 执行体与 SSH 标准通道，接入当前仓库，
跑通 aGraph/ARGO MCP，完成端到端验收并汇报。
```

之后等 Agent 干活。缺 Key、权限或需要你决策时，它会一次性列给你。

---

## 2. Agent 执行手册（人类可跳过）

### 2.0 原则

1. **镜像优先**：Paperclip 控制台用镜像部署，不在主机上 `pnpm install` / `pnpm dev` 跑源码。
2. **argo-deploy 与 argo-init 分开**：前者安装，后者初始化；不要合并。
3. **SSH 是标准通道**：项目绑定 Agent 必须 `directRemoteWorkspace=true` + SSH 环境。
4. **仓库只有一份**：Windows `D:\Projects\paperclip`；WSL 用 `/mnt/d/Projects/paperclip`。
5. **人类只做两步**：环境准备 + 下指令；其余自动完成。
6. **只在必要时找人类**：镜像地址、Key、管理员权限、Neo4j/embedding 取舍。一次列清。

### 2.1 约定

```powershell
$ErrorActionPreference = 'Stop'
$WinRepo = 'D:\Projects\paperclip'
$WslDistro = 'ocpc'
$WslRepo = '/mnt/d/Projects/paperclip'
$Api = 'http://127.0.0.1:3100/api'
$HealthUrl = 'http://127.0.0.1:3100/api/health'
```

---

## 3. Phase A — 拉取并启动 Paperclip 镜像

### 3.1 获取镜像

向部署负责人要当前分支的镜像地址，例如：

```text
crpi-33yedsa348aqgw1p.cn-shenzhen.personal.cr.aliyuncs.com/paperclip/paperclip-fork:<tag>
```

```powershell
$Image = '<由部署负责人提供>'
docker pull $Image
```

离线环境用 `docker load -i paperclip-fork-<tag>.tar`。

### 3.2 启动控制台

先看镜像的入口和需要的环境变量：

```powershell
docker inspect $Image --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}}'
```

最小启动（本机单用户）：

```powershell
docker run -d --name paperclip `
  -p 127.0.0.1:3100:3100 `
  -e HOST=0.0.0.0 -e PAPERCLIP_BIND_HOST=0.0.0.0 -e PORT=3100 -e SERVE_UI=true `
  -e PAPERCLIP_HOME=/paperclip `
  -e PAPERCLIP_DEPLOYMENT_MODE=local_trusted `
  -e PAPERCLIP_DEPLOYMENT_EXPOSURE=private `
  -v paperclip-data:/paperclip `
  --restart unless-stopped --stop-timeout 90 `
  $Image
```

如果镜像需要首次初始化，按镜像文档在容器内执行 `paperclipai onboard --yes`，
或用 `--env-file` 注入现成实例配置。以 `/api/health` 为准。

### 3.3 健康检查

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
docker logs --tail 50 paperclip
```

验收：`status: ok`，UI `http://127.0.0.1:3100` 可打开。

---

## 4. Phase B — 准备 WSL 执行体

```powershell
wsl.exe -l -v
```

优先复用已有 Ubuntu（例如 `ocpc`）；没有就 `wsl.exe --install -d Ubuntu`。

安装依赖：

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y build-essential git curl ca-certificates wget ripgrep \
  openssh-server python3 python3-venv
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node -v
npm install -g pnpm@9.15.4
if ! command -v opencode >/dev/null 2>&1; then
  npm install -g opencode-ai
fi
opencode --version
if ! command -v pwsh >/dev/null 2>&1; then
  wget -q https://packages.microsoft.com/config/ubuntu/24.04/packages-microsoft-prod.deb \
    -O /tmp/packages-microsoft-prod.deb
  dpkg -i /tmp/packages-microsoft-prod.deb
  apt-get update
  apt-get install -y powershell
fi
systemctl enable --now ssh || systemctl enable --now sshd
'@
```

确认仓库挂载：

```powershell
wsl.exe -d $WslDistro -- bash -lc 'ls -l /mnt/d/Projects/paperclip/AGENTS.md'
wsl.exe -d $WslDistro -- bash -lc 'cd /mnt/d/Projects/paperclip && git rev-parse --abbrev-ref HEAD'
```

---

## 5. Phase C — WSL 侧 aGraph（安装与初始化分开）

### 5.1 安装 aGraph

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
set -e
npm install -g archgraph-argo
export PATH="$(npm prefix -g)/bin:$PATH"
argo-deploy
'@
```

### 5.2 确保 WSL 内 Neo4j 可连

```powershell
wsl.exe -d $WslDistro -- bash -lc 'timeout 3 bash -c "</dev/tcp/127.0.0.1/7687" && echo neo4j-ok || echo neo4j-down'
```

按顺序处理：

1. 复用 Windows Neo4j 的反向隧道（WSL `127.0.0.1:7687` 由 sshd 转发）。
2. WSL Docker 起 Neo4j：
   ```bash
   docker run -d --name argo-neo4j --restart unless-stopped \
     -p 127.0.0.1:7474:7474 -p 127.0.0.1:7687:7687 \
     -e "NEO4J_AUTH=neo4j/<强密码>" -v argo_neo4j_data:/data neo4j:5
   ```
3. 都没有就问人类。

### 5.3 写 `~/.argo/.env`

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
cat > /root/.argo/.env <<"EOF"
ARGO_NEO4J_DATABASE_URL=neo4j://127.0.0.1:7687
ARGO_NEO4J_DATABASE_USERNAME=neo4j
ARGO_NEO4J_DATABASE_PASSWORD=<密码>
ARGO_EMBEDDING_PROFILE=openai-compatible
ARGO_EMBEDDING_BASE_URL=<base URL>
ARGO_EMBEDDING_MODEL=<模型名>
ARGO_EMBEDDING_PROVIDER=<provider 标签>
ARGO_EMBEDDING_MODEL_VERSION=<版本标签>
ARGO_EMBEDDING_DIMENSIONS=1536
QWEN_KEY=<embedding Key>
EOF
chmod 600 /root/.argo/.env
'@
```

### 5.4 初始化 aGraph（单独执行）

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
cd /mnt/d/Projects/paperclip
export PATH="$(npm prefix -g)/bin:$PATH"
if command -v argo-init >/dev/null 2>&1; then argo-init; else node /root/.argo/bin/argo-init.js; fi
'@
```

读取报告，验收：`status: ok`；`neo4j.database == paperclip`；
`qeaFullProjection.qea == /mnt/d/Projects/paperclip/paperclip.qea`；
`semanticLifecycle` 为 `ok` 或明确记录降级。

### 5.5 系统级 OpenCode 配置

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
mkdir -p /etc/opencode
cp /root/.config/opencode/opencode.json /etc/opencode/opencode.json 2>/dev/null || true
cp /root/.config/opencode/AGENTS.md /etc/opencode/AGENTS.md 2>/dev/null || true
grep -n '"argo"' /etc/opencode/opencode.json || true
'@
```

---

## 6. Phase D — 建立 SSH 标准通道

### 6.1 WSL sshd 与密钥

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
set -e
systemctl enable --now ssh || systemctl enable --now sshd
mkdir -p /root/.ssh && chmod 700 /root/.ssh
[ -f /root/.ssh/paperclip_env ] || ssh-keygen -t ed25519 -N "" -f /root/.ssh/paperclip_env -C paperclip-exec
grep -qxF "$(cat /root/.ssh/paperclip_env.pub)" /root/.ssh/authorized_keys 2>/dev/null || cat /root/.ssh/paperclip_env.pub >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
ss -lntp | grep -E ":22|:2222" || true
'@
```

端口冲突时改 2222：

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
sed -i "s/^#*Port .*/Port 2222/" /etc/ssh/sshd_config
systemctl restart ssh || systemctl restart sshd
ss -lntp | grep 2222
'@
```

### 6.2 自连验证

```powershell
wsl.exe -d $WslDistro -- bash -lc @'
ssh -i /root/.ssh/paperclip_env -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null -p 2222 root@127.0.0.1 \
  "cd /mnt/d/Projects/paperclip && pwd && git rev-parse --abbrev-ref HEAD"
'@
```

### 6.3 在 Paperclip 创建 SSH 环境

UI：**Company Settings → Instance → Environments → New Environment → SSH**

| 字段 | 值 |
|---|---|
| Name | `WSL Exec · paperclip` |
| Host | `127.0.0.1` |
| Port | `2222` |
| Username | `root` |
| Remote workspace path | `/mnt/d/Projects/paperclip` |
| Private key | secret，内容为 `/root/.ssh/paperclip_env` |
| Strict host key checking | 关闭 |

点 **Probe**，必须 `ok: true`，`remoteCwd == /mnt/d/Projects/paperclip`。

---

## 7. Phase E — 创建执行 Agent 和项目

### 7.1 公司

```powershell
$Company = Invoke-RestMethod -Method Post -Uri "$Api/companies" -ContentType 'application/json' -Body (@{
  name = 'Paperclip Single Machine'; description = 'Image deploy + WSL executor + SSH'; budgetMonthlyCents = 0
} | ConvertTo-Json)
$CompanyId = $Company.id
```

### 7.2 模型与 OpenCode 路径（WSL）

```powershell
wsl.exe -d $WslDistro -- bash -lc 'export PATH="$(npm prefix -g)/bin:$PATH"; opencode models | head -n 30'
wsl.exe -d $WslDistro -- bash -lc 'export PATH="$(npm prefix -g)/bin:$PATH"; command -v opencode'
```

### 7.3 创建 Agent（SSH 标准）

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
  runtimeConfig = @{ heartbeat = @{ enabled = $true; maxConcurrentRuns = 1 } }
  budgetMonthlyCents = 0
} | ConvertTo-Json -Depth 12

$Agent = Invoke-RestMethod -Method Post -Uri "$Api/companies/$CompanyId/agents" `
  -ContentType 'application/json' -Body $AgentBody
$Agent.id
```

需要 AI connection 时，按 7.4 创建后，把 `runtimeConfig.aiConnection` 带上重试。

### 7.4 接入模型（按需）

```powershell
$Conn = Invoke-RestMethod -Method Post -Uri "$Api/companies/$CompanyId/ai-connections" `
  -ContentType 'application/json' -Body (@{
    provider = 'openai'; method = 'api_key'; name = 'Paperclip OpenAI';
    ownership = 'shared'; apiKey = '<人类提供>'; allAgents = $true
  } | ConvertTo-Json)
```

`runtimeConfig.aiConnection`：

```json
{ "mode": "shared", "method": "api_key", "provider": "openai",
  "connectionId": "<Conn.id>", "grantId": "<Conn.grantId>" }
```

### 7.5 项目绑定

```powershell
$Project = Invoke-RestMethod -Method Post -Uri "$Api/companies/$CompanyId/projects" `
  -ContentType 'application/json' -Body (@{
    name = 'paperclip'; leadAgentId = $Agent.id; status = 'planned'
  } | ConvertTo-Json)
$Project.id
```

---

## 8. Phase F — 执行器部署任务（Paperclip Agent）

在 Paperclip 里新建任务，指派给 `$Agent`，内容：

```text
部署 Paperclip 执行器：
1. 确认 /mnt/d/Projects/paperclip 可访问，分支 dev/local-install。
2. 确认 opencode --version、ARGO MCP 可用。
3. 调用 queryNeo4jGraph {schema:true}、validateSystemArchitecture、memory_search。
4. 报告 cwd、分支、MCP 结果；只读，不修改文件。
5. 完成后汇报。
```

API：

```powershell
$Issue = Invoke-RestMethod -Method Post -Uri "$Api/companies/$CompanyId/issues" `
  -ContentType 'application/json' -Body (@{
    title = 'Deploy Paperclip executor (WSL SSH standard)'
    description = '<上面的任务文本>'
    projectId = $Project.id
    assigneeAgentId = $Agent.id
    status = 'todo'
  } | ConvertTo-Json -Depth 6)
```

验收：cwd = `/mnt/d/Projects/paperclip`；分支 `dev/local-install`；
ARGO MCP 工具可调用；`validateSystemArchitecture` passed。

---

## 9. 验收清单

- [ ] `docker pull` 成功；Paperclip 容器 running；`/api/health` = ok。
- [ ] WSL：Node/pnpm/OpenCode/pwsh/sshd 可用。
- [ ] WSL：`/mnt/d/Projects/paperclip` 可访问。
- [ ] `argo-deploy` 与 `argo-init` 分开执行；init 报告 `status: ok`。
- [ ] SSH Probe ok，`remoteCwd=/mnt/d/Projects/paperclip`。
- [ ] Agent：`opencode_local` + `directRemoteWorkspace=true` + SSH 环境。
- [ ] 项目已绑定 `leadAgentId`。
- [ ] 执行器部署任务通过。

---

## 10. 常见问题

| 现象 | 处理 |
|---|---|
| `docker pull` 失败 | 检查镜像地址/registry 登录；离线用 `docker load` |
| 容器起不来 | `docker logs paperclip`；检查 env/volume/端口 3100 |
| `/api/health` 不 ok | 等启动；检查 `PAPERCLIP_HOME`、数据库/实例配置 |
| `argo-init` 找不到 | `export PATH="$(npm prefix -g)/bin:$PATH"`，或 `node /root/.argo/bin/argo-init.js` |
| `argo-init` 报 Neo4j 失败 | 检查 WSL `127.0.0.1:7687`；反向隧道或 WSL Docker |
| `argo-init` 报数据库名不一致 | 仓库目录名应为 `paperclip`，或设 `ARGO_NEO4J_DATABASE=paperclip` |
| SSH Probe 失败 | 检查 2222、root key、authorized_keys、`/mnt/d/...` |
| `project_agent_direct_workspace_required` | 打开 `directRemoteWorkspace` |
| `project_agent_remote_environment_required` | `defaultEnvironmentId` 改 SSH 环境 |
| Agent 没有 ARGO 工具 | 检查 `/etc/opencode/opencode.json` 与 `ARGO_REPO_ROOT`；重启 Paperclip |

---

## 11. 标准与红线

1. **镜像部署**：Paperclip 控制台先 `docker pull`，再 `docker run`；不在主机跑源码。
2. **安装与初始化分开**：`argo-deploy`（安装）与 `argo-init`（初始化）是两个步骤。
3. **SSH 是唯一执行通道**：项目绑定 Agent 必须 SSH 环境 + Direct remote workspace。
4. **仓库只有一份**：Windows `D:\Projects\paperclip`；WSL 用 `/mnt/d/...`，不复制。
5. **人类只做两步**：准备环境 + 下指令；其余由 Agent 自动完成。
6. **密钥不进仓库**：只写 `~/.argo/.env`、`~/.paperclip`、Paperclip secret。

---

## 12. 附录：关键路径

| 内容 | 路径 |
|---|---|
| Windows 仓库 | `D:\Projects\paperclip` |
| WSL 仓库 | `/mnt/d/Projects/paperclip` |
| Paperclip 镜像 | 由部署负责人提供 |
| Paperclip 控制台 | `http://127.0.0.1:3100` |
| Paperclip 容器数据 | Docker volume `paperclip-data` |
| ARGO（WSL） | `/root/.argo` |
| ARGO 配置（WSL） | `/root/.argo/.env` |
| OpenCode 系统配置（WSL） | `/etc/opencode/opencode.json` |
| 项目图谱 | `/mnt/d/Projects/paperclip/design/KG/SystemArchitecture.json` |
| argo-init 报告 | `/mnt/d/Projects/paperclip/.argo/temp/argo-harness-init-report.json` |
