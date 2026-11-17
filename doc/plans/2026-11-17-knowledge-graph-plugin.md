# Knowledge Graph 插件设计与实施方案（Phase 1）

- Status: proposal (revised)
- Date: 2026-11-17
- Owner: 项目经理（project-manager-001）
- Supersedes: Project Tree 插件（删除，不再提供 `/organization` 项目树页面）
- KG element: `graph-review-plugin-proposal-2026-11-17`

## 1. 结论

1. **删除 `plugin-project-tree`**，不再保留 Project Tree 页面。
2. 新建 **Knowledge Graph** 插件：`plugin-knowledge-graph`，展示名 `Knowledge Graph`，路由 `knowledge-graph`。
3. **每个项目一个知识图谱入口**。图谱来源就是该项目的执行环境/工作区（Project → Lead Agent → workspace）。
4. **Phase 1 只做“拉取 + 落盘 + 展示 + 重合点查看”**：
   - 控制面通过 SSH 从执行机拉取图谱 JSON，存到 Paperclip 所在控制面的本地目录；
   - 不建图数据库、不做图检索、不做裁决写回；
   - 页面提供：每个项目的 **本体（结构定义）** 与 **内容**；一个独立的 **Overlaps** 菜单查看各图谱之间的重合关系。
5. 交互与布局参考 LLM Wiki：`page + routeSidebar + sidebar`，左侧项目列表、右侧内容区、按 section 深链。

## 2. 删除 Project Tree：为什么可以删、删什么

你的判断成立：Project Tree 只多表达了 **project → lead**；而 **team member** 已经由 Agent 组织里的汇报关系（`reportsTo`）表达。继续维护一个独立树页面，收益不清、还会带来分叉和副作用。

删除后仍然保留的事实（不需要任何新 UI）：

- `Project` 实体、`projects.parent_project_id`、`projects.lead_agent_id` 不动；
- Agent 组织页继续展示 lead 与 team 的汇报关系；
- 项目列表/项目设置继续承担项目管理。

删除清单：

| 位置 | 动作 |
| --- | --- |
| `packages/plugins/plugin-project-tree/**` | 删除整个包 |
| `server/src/services/bundled-plugins.ts` | 删除 catalog 条目 `project-tree` 与 `SELF_HOSTED_AUTO_INSTALL_KEYS` 中的键 |
| `Dockerfile` | 删除 `COPY .../plugin-project-tree/package.json` 与 `RUN pnpm --filter @paperclipai/plugin-project-tree build` |
| `pnpm-lock.yaml` | `pnpm install` 更新 |
| 已部署实例（47/内网） | 一次性在 Settings → Plugins 卸载 `paperclip-project-tree`（bundled 代码没有自动卸载路径） |

已核对：`ui/src/App.tsx` 当前没有 `/organization` 路由，Sidebar 里的 “Organization” 是公司分区，不是该插件导航；删除插件不需要改 core UI。

## 3. Project ↔ 环境/工作区映射

目标模型：**一个项目 = 一个知识图谱 = 该项目的工作区（执行机上的一个 environment/workspace）**。

可自动获得的部分：

- `ctx.projects.list()` / `projects.get()`：`leadAgentId`、`environmentId?`、`primaryWorkspace`；
- `ctx.projects.getPrimaryWorkspace(projectId, companyId)`（`project.workspaces.read`）：工作区绝对路径 `path`、`repoUrl`。

不能自动获得的部分（已核对）：

- 插件 **读不到 environment 的 SSH 坐标**：SDK 没有 environments 客户端；`PLUGIN_DATABASE_CORE_READ_TABLES` 也不含 `environments`（见 `packages/shared/src/constants.ts`）。这是有意的安全边界，避免插件拿到环境私钥。

因此 Phase 1 的映射方式是：

1. 在插件 Settings 里为每个 **environmentId** 配置一次 SSH 坐标：`host`、`port`、`username`、`keySecretRef`、`knownHosts/fingerprint`；可加一个人类可读 label。
2. 每个项目自动取 `project.environmentId`（为空时回退到 lead agent 的 `defaultEnvironmentId`；仍为空则要求显式选择）。
3. 项目的工作区路径自动取 `primaryWorkspace.path`（例如 `/root/repos/xxx`），允许手工覆盖。
4. 图谱路径默认 `design/KG/SystemArchitecture.json`，本体目录默认 `.argo/schema`。

这样项目菜单是“按项目”的，实际拉取是“按该项目的环境/工作区”的。若以后希望零配置，可在 core 增加一个只读的 environment 坐标能力，再让插件自动解析；Phase 1 不做。

## 4. Phase 1 范围

**做：**

- 删除 Project Tree 插件（第 2 节）。
- 新插件页面：项目列表、每项目 `Ontology` / `Content`、独立 `Overlaps`、`Settings`。
- 手动 `Sync now` + 可选的定时拉取（默认关闭）。
- SSH 拉取快照，存到控制面本地文件夹；原子替换 `current`。
- 展示 commit / dirty / generatedAt / schema 来源 / 校验状态。
- Overlaps 只读查看：按类型分组的重合候选与证据。
- 失败保留上一次成功快照并标记 stale；同步记录写入本地 `runs.jsonl`。

**不做：**

- 不做图检索（无搜索框、无元素搜索、无 Agent 图查询工具）；
- 不建 Neo4j / ARGO 投影 / embedding；
- 不做 Postgres 表（Phase 1 用本地 JSON + plugin state）；
- 不做人工裁决/概念组写回；
- 不向项目图谱写回；
- 不入库 `.qea` 二进制；
- 不做跨公司比较。

## 5. 页面与交互（参考 LLM Wiki）

- 侧栏：`Knowledge Graph`
- 路由：`<companyPrefix>/knowledge-graph`
- Sections（与 LLM Wiki 的 section 深链一致）：
  - `projects`（默认）：左侧项目列表 + 选中项目的图谱；
  - `overlaps`：跨图谱重合关系；
  - `settings`：环境坐标、默认路径、保留策略、SSH 配置。

```
┌ 项目列表 (routeSidebar) ─┬ Knowledge Graph ──────────────────────────────┐
│ vso-command              │ vso-intel   ● fresh   commit abc123   dirty no │
│ vso-intel        ●       │ ┌ Ontology ┬ Content ┐                         │
│ vso-dfir         ◐       │ │ 类型/端点矩阵/actor 契约/校验状态            │
│ QwenPaw labs     ○       │ │ 或：视图树 + 元素表 + 元素详情               │
│ ...                      │ └──────────────────────────────────────────────┘ │
└──────────────────────────┴────────────────────────────────────────────────┘
```

- 项目行：名称（`parentProjectId` 时带 `↳ parent` 提示，不做可折叠树）、状态点（fresh/stale/dirty/never/error）、最近同步时间。
- 项目的 `Content`：
  - 视图列表（顶层 `SystemArchitecture` + 子视图）作为导航；
  - 选中视图后列出成员元素，点击看详情（类型、描述、属性、入/出关系、testcases、provenance）；
  - 默认隐藏 `attributes.memoryTier` 的 T1/T2/T3 记忆元素，提供“包含记忆”开关；
  - 不做搜索。
- 项目的 `Ontology`：
  - 类型枚举、关系类型、端点约束矩阵、`actorElementType`、自定义 vs 内置；
  - schema 来源（default / workspace override）、版本与 digest、校验状态；
  - 该类型被哪些其他项目使用（共享词汇），同名不同义只在 Overlaps 里作为 “type conflict” 展示。
- `Overlaps`：
  - 过滤：项目 A/B、重合种类；
  - 并排卡片：两侧元素名称/类型/描述摘要/来源 commit；
  - 证据行说明“为什么被标记”；Phase 1 不提供裁决按钮。

## 6. 传输与落盘

### 6.1 方向

主路径：**控制面拉取**。复用现有“控制面 → 执行机”的 SSH 方向（环境 probe 已证明可用）。

备选：**执行机推送落盘**。执行机用 systemd timer 把 bundle `scp` 到插件本地文件夹的 `inbox/`，插件 job 扫描摄取。两种方式共用同一 bundle 格式与摄取管线。

### 6.2 快照包

```
kb-bundle/
  manifest.json
  graph/SystemArchitecture.json
  ontology/schema.json
  ontology/config.json
  ontology/rules.json      # 可选，超过上限只存 digest + 计数
```

`manifest.json` 至少包含：`bundleVersion`、`sourceKey`、`generatedAt`、`repo{path,branch,commit,dirty}`、`graph{path,sha256,bytes,counts}`、`schema{kind,language,id,version,digest,validation}`。

导出脚本 `knowledge-graph-export.mjs`（随插件分发到执行机）负责：读取 git commit/dirty、计算 digest 与计数、收集覆盖过的 schema、输出 gzip tar 到 stdout。

### 6.3 落盘布局（控制面本地文件夹）

```
<localFolder>/
  projects/<projectId>/
    source.json                 # 环境/工作区/路径/最近状态
    current/
      manifest.json
      graph.json
      ontology.json             # 解析后的类型/端点/actor 契约摘要
    history/<commit>-<digest>/
      manifest.json  graph.json  ontology.json
    runs.jsonl
  inbox/<projectId>/            # push 备选
```

- 写入 `tmp/` 后原子 rename 到 `current/`；失败不破坏旧快照。
- 保留：默认最近 10 个快照或 30 天；`current` 永不删除。
- 所有配置与运行状态用 `ctx.state`（company/project scope）+ 本地文件；Phase 1 不需要数据库迁移。

### 6.4 安全

- 专用只读密钥保存在 Paperclip secret，`ctx.secrets.resolve()` 调用时解析，写 0600 临时文件并删除；不落库、不打日志。
- 执行机 `authorized_keys` 使用 `restrict,command="/opt/paperclip/bin/knowledge-graph-export ..."`：无 shell、无转发、只读。
- 注册时展示并固定 host key 指纹；变化则拒绝。
- tar 条目白名单，拒绝绝对路径/`..`/symlink；大小与超时上限；只解析不执行。
- source 写入仅 board；读取按 company 隔离；写 activity log。

## 7. Overlaps（Phase 1 只读）

归一化：`NFKC → lower → 空白折叠 → 去标点`。只在 **相同 schemaKind/language** 内自动比较。

| kind | 规则 |
| --- | --- |
| `exact_name` | 同 type + 归一化名称相等（score 1.0） |
| `same_alias` | type + alias/classifier 相等 |
| `desc_hash` | 归一化描述哈希相等 |
| `near_name` | 同 type，trigram ≥ 0.62 或 token Jaccard ≥ 0.75（名称长度 ≥ 3） |
| `cross_ref` | 描述/属性中出现 `graph://`、`repo://`、`<projectKey>/design/KG`、项目 id |
| `type_conflict` | 不同项目的同名类型定义不同 |

计算在请求时进行：读取各项目最近的 `current` 快照，按 `(schemaKind, type)` 分组，先哈希精确匹配再 trigram 倒排取候选；结果按“证据集合的 digest”在内存缓存，快照变化即失效。Phase 1 不持久化裁决。

## 8. 工程改造

### 8.1 新包

```
packages/plugins/plugin-knowledge-graph/
  package.json  tsconfig.json  vitest.config.ts  README.md
  scripts/build-ui.mjs
  src/manifest.ts  src/constants.ts  src/index.ts  src/worker.ts
  src/transport/{ssh-exec.ts, drop-folder.ts, index.ts}
  src/bundle/{verify.ts, export-script.ts, normalize.ts}
  src/graph/{parse.ts, ontology.ts, overlaps.ts}
  src/api/routes.ts
  src/ui/{index.tsx, SidebarLink.tsx, RouteSidebar.tsx, KnowledgeGraphPage.tsx,
           sections/{ProjectsSection,OverlapsSection,SettingsSection}.tsx,
           project/{OntologyTab,ContentTab}.tsx, components/*}
  tests/{manifest.spec.ts, bundle.spec.ts, overlaps.spec.ts, routes.spec.ts, ui.spec.ts}
  tests/screenshots/{harness.tsx, entry.tsx, capture.mjs}
```

### 8.2 manifest

- capabilities：`projects.read`、`agents.read`、`project.workspaces.read`、`local.folders`、`secrets.read-ref`、`jobs.schedule`、`api.routes.register`、`activity.log.write`、`plugin.state.read`、`plugin.state.write`、`ui.page.register`、`ui.sidebar.register`。
- **不申请** `database.*`（Phase 1 无迁移）。
- `localFolders`：`knowledge-graph`（readWrite；`projects/`、`inbox/`、`tmp/`）。
- `ui.slots`：`page(knowledge-graph)` + `sidebar` + `routeSidebar(knowledge-graph)`。
- `instanceConfigSchema`：保留天数、单包上限、默认 graph/schema 路径、同步超时、是否默认包含记忆元素。
- `jobs`：`sync-project`（manual）、`sync-scheduled`（可选/默认关闭）、`prune-snapshots`。

### 8.3 路由

```
GET    /projects                     # 项目 + KG 状态（含未配置）
GET    /projects/:projectId          # 当前快照摘要 + ontology + counts
GET    /projects/:projectId/views
GET    /projects/:projectId/views/:viewId
GET    /projects/:projectId/elements/:elementId
POST   /projects/:projectId/sync
GET    /projects/:projectId/runs
PATCH  /projects/:projectId/source
GET    /overlaps?left=&right=&kind=
GET    /settings
PATCH  /settings
```

写路由 `auth: board`；读路由 `board-or-agent`；统一 company scope。

### 8.4 删除与注册改动

1. 删除 `packages/plugins/plugin-project-tree/`。
2. `server/src/services/bundled-plugins.ts`：删除 `project-tree`，新增 `{ key: "knowledge-graph", pluginKey: "paperclip-knowledge-graph", relativePath: "plugin-knowledge-graph" }`；更新 `SELF_HOSTED_AUTO_INSTALL_KEYS`。
3. `Dockerfile`：替换 COPY/build 行。
4. `pnpm-lock.yaml`。
5. 部署 runbook：插件清单 + 旧插件卸载步骤。

UI 使用宿主 CSS 变量与 `DESIGN.md` token 语义；不引入 hex/raw px；复用 LLM Wiki 的 section 深链与移动端折叠处理。

## 9. 分阶段验收（GIVEN-WHEN-THEN）

### 9.1 删除与替换

- GIVEN 镜像包含新插件且旧插件已从 catalog 移除
  WHEN 启动自托管实例
  THEN `paperclip-knowledge-graph` ready，`paperclip-project-tree` 不再自动安装；`/knowledge-graph` 返回 200。
- GIVEN 已部署实例
  WHEN 按 runbook 卸载旧插件
  THEN 旧侧栏入口消失，项目与 Agent 数据不受影响。

### 9.2 拉取与落盘

- GIVEN 某项目绑定 environment 且配置了只读密钥
  WHEN 点击 `Sync now`
  THEN 控制面取回 bundle，校验 digest/计数后原子替换 `current`，页面显示 commit/dirty/generatedAt。
- GIVEN 同一 commit 重复同步
  WHEN 再次执行
  THEN 幂等：不新增 history 目录，`current` 内容不变。
- GIVEN bundle 被篡改或含路径穿越
  WHEN 摄取
  THEN 拒绝并返回精确错误，`current` 保持旧快照。
- GIVEN 同步失败
  WHEN 打开项目
  THEN 仍可浏览旧快照，顶部显示 stale 与错误摘要。

### 9.3 本体与内容

- GIVEN 项目图谱有 28 个视图
  WHEN 打开 Content
  THEN 视图成员的展示与 canonical `included_elements` 一致。
- GIVEN 元素带 testcases 与 attributes
  WHEN 打开详情
  THEN 显示类型/描述/关系/testcases/provenance；commit 账本默认折叠。
- GIVEN 默认过滤开启
  WHEN 浏览
  THEN `memoryTier` 元素隐藏；打开开关后出现并带记忆标记。

### 9.4 Overlaps

- GIVEN 两个项目有同 type 同归一化名元素
  WHEN 打开 Overlaps
  THEN 出现一条 `exact_name` 证据，score 1.0。
- GIVEN 两个项目 schema 同名不同定义
  WHEN 打开 Overlaps
  THEN 出现 `type_conflict`，不被当作同义元素合并。
- GIVEN 不同 schemaKind
  WHEN 比较
  THEN 默认不比较或标记 `unverified`（Phase 1 可选择只显示同 kind）。

### 9.5 真实环境

- GIVEN 47（或内网）实例 + 一个真实执行机
  WHEN 完成一次项目同步
  THEN 控制面本地目录出现快照，页面可浏览；health 与三向 HEAD 校验保持通过。

## 10. 风险与决策

| 风险 | 缓解 |
| --- | --- |
| 插件 worker 起子进程 | 生产镜像自带 `openssh-client/git/tar`（`Dockerfile:202`）；Phase 0 实测；失败则改用 `ssh2` 内存私钥 |
| 环境坐标需手工录入 | 每个 environment 只配一次；workspace 路径自动取 `primaryWorkspace` |
| 图谱含 Agent 私人记忆 | 默认过滤 `memoryTier`；按公司隔离；不提供公网导出 |
| 快照体积 | 上限 + 流式 + 压缩；rules/guide 可选；`.qea` 不入库 |
| 跨本体误报 | 同 schemaKind 才自动比较；跨本体标记 unverified |
| 控制面不能出站 | 切换 drop-folder（`inbox/`）复用同一摄取管线 |

**需要你拍板（其余按上述默认）：**

1. 传输主路径：控制面拉取（推荐）还是执行机推送？
2. 环境坐标：按 environment 手工配置一次（推荐）还是要求 core 增加只读环境坐标能力做到零配置？
3. Overlaps Phase 1 深度：只做“精确同名 + 共享类型”（更保守）还是加近似名/描述哈希（推荐）？

## 11. 后续（不在 Phase 1）

- 人工裁决与概念组（复用裁决、证据变化重开）；
- 元素/描述检索与只读 Agent 工具；
- graph-mcp 联邦中心作为额外 source（by reference）；
- `.qea` 几何导出与画布布局；
- 裁决结果经各项目 Lead Agent 受控写回项目图谱。
