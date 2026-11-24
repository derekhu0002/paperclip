# SSH 执行机对接：`scripts/prepare-ssh-executor.sh`

> 用途归档。本文只描述 **设备侧准备与自检**，不是 enrollment（Paperclip 目前没有"生成一段命令自动回连"的执行机接入流程）。

## 它解决什么

SSH environment 的痛点是**方向**：控制面主动拨执行机，所以必须先知道可达地址、端口、SSH 用户、远端仓库路径，再保证链路通。这个脚本把"猜"换成"机器自己报"，并在设备侧完成授权：

1. 把 Paperclip 侧公钥写入 `~/.ssh/authorized_keys`（按 key blob 去重、先备份、`700/600`）
2. 检查 sshd 是否存在、哪个端口在监听（可选写 drop-in 配置并重启）
3. 复现 Paperclip 的 SSH 命令环境（先 source `~/.profile` → `~/.bash_profile` → `~/.bashrc`），验证 agent CLI 在非交互 PATH 上
4. 匿名探测 `GET <server>/api/liveness`，证明**执行机 → Paperclip** 这一跳通
5. 打印可直接粘进环境表单的字段、`known_hosts` 行与 host key 指纹

它**不做**：不创建 environment、不生成 ticket、不打通"Paperclip → 执行机"（那是 sshd + 网络的事）。

## 前置

- Paperclip 侧：准备好该 environment 使用的私钥（或 company SSH secret）。执行机只收公钥。
- 执行机：Linux/WSL，能出站访问 Paperclip 的地址。若 Paperclip 在 Docker 里，`--server-url` 要填**执行机视角**可达的那个源（通常就是公网 HTTPS 域名）。

## 快速开始

在 **Paperclip 主机**上导出公钥：

```sh
ssh-keygen -y -f ./paperclip_key > paperclip_key.pub
```

把 `paperclip_key.pub` 传到执行机，然后**在执行机上**运行：

```sh
bash prepare-ssh-executor.sh \
  --pubkey "$(cat paperclip_key.pub)" \
  --port 2222 \
  --server-url https://paperclip.example.com \
  --workspace /root/repos/my-project
```

只想看报告、不改 `authorized_keys`：

```sh
bash prepare-ssh-executor.sh --report-only --workspace /root/repos/my-project
```

## 参数

| 参数 | 说明 |
| --- | --- |
| `--pubkey KEY` | 要授权的 Paperclip 侧公钥，可重复 |
| `--pubkey-file PATH` | 从文件批量读取公钥（忽略注释行/空行） |
| `--port N` | Paperclip 将拨的 sshd 端口，默认 `2222` |
| `--server-url URL` | Paperclip 基址；用于执行机 → Paperclip 的出站自检 |
| `--ca-bundle PATH` | 私有 CA 的 https `--server-url` 场景 |
| `--insecure` | 跳过 TLS 校验（自签证书临时代价） |
| `--harness NAME\|PATH` | 必须在 SSH 环境里解析到的 agent CLI，默认 `opencode` |
| `--workspace PATH` | 要上报的仓库路径，默认当前目录 |
| `--install-sshd` | 缺失时用 apt 安装 `openssh-server`（需要 sudo） |
| `--apply-sshd-config` | 写 `/etc/ssh/sshd_config.d/99-paperclip.conf` 并重启 sshd（需要 sudo） |
| `--json` | 输出机器可读报告 |
| `--report-only` | 只报告；不要求已授权公钥 |
| `-h`, `--help` | 帮助 |

`--apply-sshd-config` 写入的内容只有 `Port`、`PubkeyAuthentication yes`、`PasswordAuthentication no`、`UsePAM yes`，**不改** `PermitRootLogin`；没有已授权 key 时会拒绝执行，避免把自己锁在外面。`sshd -t` 不通过则不重启。

## 报告怎么填进 Paperclip

脚本输出的 `ENVIRONMENT` 段与环境表单的字段一一对应：

| 脚本输出 | 环境字段 | 备注 |
| --- | --- | --- |
| `driver = ssh` | Driver | |
| `host` | Host | 已优先选择非 NAT 地址（有 Tailscale 就用它） |
| `port` | Port | 与 `--port` 一致 |
| `username` | Username | 当前 SSH 用户 |
| `remoteWorkspacePath` | Remote workspace path | 仓库绝对路径 |
| `knownHosts` | Known hosts | 形如 `[ip]:port ssh-ed25519 AAAA...` |
| host key 指纹 | — | 与服务器侧核对用 |
| `privateKey` | Private key | 私钥只存在于 Paperclip 侧，永远不要贴到执行机 |

填完后在 Paperclip 里点 **Test**——那才是"Paperclip → 执行机"的最终验收；本脚本只证明反方向与配置项齐全。

## HTTPS / 反向代理

`--server-url` 用你登录界面的那个源即可，它与实例的 `PAPERCLIP_PUBLIC_URL` 一致。判定规则：

- `2xx` 通过；`3xx` 视为可达，但会提示确认不是跳到了登录页
- `401/403` 视为"到了但被拦"（host allowlist 或代理），需要排查而不是改网络
- 自签/私有 CA：`--ca-bundle /path/ca.pem`，或临时 `--insecure`
- 无 scheme 会自动补 `https://`
- 失败会区分 DNS、TLS、超时、代理（curl exit code）

## agent 回调地址由谁决定

远端 agent 进程的 `PAPERCLIP_API_URL` **不是**本脚本设置的，也不是 environment 配置里的；它来自 Paperclip server 进程：

```text
config.ts:218-233   authPublicBaseUrl ← PAPERCLIP_AUTH_PUBLIC_BASE_URL | BETTER_AUTH_URL
                                      | PAPERCLIP_PUBLIC_URL | config.json auth.publicBaseUrl
index.ts:1017-1044  runtimeApiUrl = choosePrimaryRuntimeApiUrl(...)   # 有公网源就用公网源
                    process.env.PAPERCLIP_API_URL = $PAPERCLIP_API_URL || runtimeApiUrl
server-utils.ts:3319-3329  buildPaperclipEnv() 把 PAPERCLIP_API_URL 带进 adapter 子进程
```

因此：

- 设了 `PAPERCLIP_PUBLIC_URL=https://paperclip.example.com` → 自动正确
- 没设时，Docker 内 bind 为 `0.0.0.0`，会兜底成 `http://localhost:3100`，**远端执行机必然失败**
- 显式 `PAPERCLIP_API_URL` 优先级最高，建议与公网源一起钉住

验证：`docker exec <paperclip容器> env | grep -E 'PAPERCLIP_(PUBLIC_URL|API_URL)'`

## WSL / Docker 拓扑注意

- 报告里的 `host` 必须是**从 Paperclip 容器内**可达的地址，不是从 Windows 宿主机。
- WSL `networkingMode=mirrored` 时 Windows 可直接访问；`nat` 模式才能直接用 WSL 的 IP。
- 有 Tailscale 时脚本直接推荐它并跳过 Windows portproxy；否则会打印 `netsh interface portproxy` 与防火墙命令，注意 portproxy 会把规则钉死在会变化的 WSL IP 上。
- 空闲 NAT 映射过期会让 SSH 抖动（表现为 `setup_failed`）；长连场景加 keepalive。

## 退出码与常见失败

| 退出码 | 含义 |
| --- | --- |
| `0` | 准备完成（`ready: true`） |
| `1` | 有硬性前置失败（无授权 key、harness 不可解析、仓库不可写、Paperclip 不可达等） |
| `2` | 参数错误 |

常见 `[FAIL]`：

- `harness 'opencode' is not on PATH for a non-interactive SSH command` → 装到 `/usr/local/bin` 或修正 profile 里的 PATH
- `no authorized key installed` → 传 `--pubkey`，或用 `--report-only`
- `TLS trust/handshake failed` → `--ca-bundle` / `--insecure`
- `workspace ... is not a git checkout` → 传正确的 `--workspace`
- `only a NAT'd WSL address is available` → 用 Tailscale、mirrored 网络，或配置 portproxy

## 安全说明

- 脚本只写 `~/.ssh/authorized_keys`（写前备份为 `authorized_keys.paperclip-backup-<时间戳>`）与可选的 sshd drop-in；不打印、不传输任何私钥。
- 未使用 `--apply-sshd-config` 时不触碰系统配置。
- 授权按 key blob 去重，重复执行是幂等的。
- 默认不修改 `PermitRootLogin`；以 root 运行时请自行确认该选项与现有策略一致。

## 已验证记录

- WSL（Ubuntu，root，`sshd` 2222）：首跑 `1 key(s) requested, 1 added`，重跑 `0 added, 1 already present`；备份生成；权限 `700/600`。
- `--json` 输出可被 `JSON.parse`；`--help` 与 `--report-only` 行为符合上表；无 key 与参数错误分别退出 `1` 与 `2`。
- 对 `https://paperclip.derekworkspacev5.com`：`GET /api/liveness` 返回 `200`，脚本判定 `outbound this host -> Paperclip works`。
