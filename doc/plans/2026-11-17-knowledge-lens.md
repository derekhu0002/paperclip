# Knowledge Lens 插件方案（讨论稿）

- Status: discussion draft — **not finalized, no implementation**
- Date: 2026-11-17
- Supersedes/continues: `doc/plans/2026-11-17-knowledge-graph-plugin.md` (initial Knowledge Graph framing)
- KG element: `knowledge-lens-proposal-2026-11-17`

## 1. 定位

**Knowledge Lens = 只读的图谱工作台 + Lens 引擎。**

- 不做建模器，不做 EA；
- 不写回项目图谱；
- 不要求 Base ontology；
- 每个 Lens = 从图谱里选出的子图 + 一种表现方式；
- 输入是元素和关系，输出是可看、可分享的界面；
- 同步不需要 Agent 参与。

## 2. 插件结构

侧栏：**Knowledge Lens**

页面：

1. **Lens Gallery（首页）**
   - 每个 Lens 一张 card：缩略图、名称、简介、来源项目、元素/关系数、更新时间、stale 标记。
   - 按类（category）分组。
   - 操作：新建 Lens、新建类、删除 Lens、复制 Lens。

2. **Lens Builder**
   - 选来源项目/快照；
   - 选元素与关系；
   - 选表现风格/布局；
   - 命名、简介、归类；
   - 保存。

3. **Lens Viewer**
   - 画布、缩放/平移、拖拽节点；
   - 边不可编辑，只能由图谱关系产生；
   - 节点/关系详情、provenance；
   - 位置按 Lens 保存；可重置自动布局。

4. **Sources**
   - 每个项目的同步状态：最近 commit、dirty、last sync、stale、错误；
   - 同步按钮；
   - 环境/工作区配置。

## 3. Lens 数据模型

```text
LensCategory (类)
  id, name, description, order

Lens
  id, categoryId, name, description
  sourceMode: "project" | "multi-project" | "committed-snapshot"
  sourceIds[], graphKey
  pinnedCommit?: string        // 可选：钉住某个快照
  stylePreset: "architecture" | "business" | "matrix" | "table" | ...
  layoutMode: "auto-layered" | "auto-swimlane" | "auto-grid" | "manual"
  createdAt, updatedAt

LensNode
  lensId, sourceId, graphKey, elementId, x, y

LensEdge
  lensId, relationshipId
```

规则：

- 节点内容来自图谱快照；Lens 只存 `elementId` 和位置。
- 边来自图谱关系；Lens 只存 `relationshipId`；不能创建/改端点/改方向。
- 元素从图里消失时显示“引用断裂”，不自动删除、不猜测替代。
- Lens 默认跟随 current 快照并显示 drift；可选钉住 commit。

## 4. Lens Builder

**Step 1：选来源**

- 项目 → 当前快照/某个 commit；
- 显示 commit、dirty、last sync、stale。

**Step 2：选元素与关系**

- 左侧：视图树（view → 元素）+ 类型 facet + 搜索；
- 多选元素；
- 自动列出选中元素之间的图谱关系；
- 关系可按类型筛选、显式勾选；**不能画新边**；
- 快捷方式：选整个 view、选某类型全部、选某元素的 1 跳邻域；
- 右侧：已选子图预览。

**Step 3：选表现方式**

- **Architecture**：分层图（Active Structure / Behavior / Passive），按类型着色；
- **Business**：泳道/时间线，适合 workflow/playbook；
- **Matrix**：类型 × 关系矩阵；
- **Table**：元素/关系清单；
- **Evidence**（后续）：指标 → 图谱证据链；
- 默认自动布局，保存后可手动拖拽节点位置。

## 5. 画布与表现

预置 preset 定义：

- 节点形状/颜色（按 type/aspect）；
- 边样式（按 relationship type）；
- 自动布局算法；
- 是否显示泳道/分组。

画布只允许：

- 拖拽节点位置；
- 缩放/平移；
- 显示/隐藏详情面板。

不允许：

- 新建/删除节点；
- 新建/删除/改接连线；
- 改元素属性。

## 6. 同步：不需要 Agent

主路径：**控制面直接拉取**。

- 每个环境配置一次：SSH host/port/user、只读密钥 secret ref、known_hosts/fingerprint。
- 每个项目配置：workspace 路径（可自动取 `primaryWorkspace.path`）、graph 路径（默认 `design/KG/SystemArchitecture.json`）、schema 目录（默认 `.argo/schema`）。
- 同步 job：插件 worker 通过 SSH 执行受限强制命令，导出 canonical graph + schema + commit/dirty；校验 digest/counts/引用；落盘 snapshot；索引到插件 DB。
- 备选：执行机侧 syncer/systemd timer 把 bundle 推到控制面 `inbox/`，插件只扫描 inbox。

现实约束：

1. 插件读不到 environment 的 SSH 坐标（SDK 无 environments client；core 可读表不含 `environments`），所以每个环境要手工配置一次 host/key；workspace 路径可自动取。
2. 如果要求 zero-config，需要 core 增加只读环境坐标能力（侵入）或 host collector（多一个部署单元）。

## 7. 索引与存储

建议使用插件自己的 Postgres namespace：

```text
sources, snapshots
elements, relationships, views
lens_categories, lenses, lens_nodes, lens_edges
sync_runs
```

- 原始图谱 JSON 落在控制面本地文件夹；
- DB 只存索引和 Lens 定义；
- 不建 Neo4j、不做 embedding、不做任意 Cypher；
- 元素/关系按 snapshot 隔离，current 指针切换。

Phase 1 如果更轻，可先只落文件、按需解析；但 Lens Builder 的选择体验会明显变差。

## 8. 类与权限

- “类”指 Lens 分类（Architecture / Business / Evidence / Org），不是图谱里的新元素类型。
- 创建/删除 Lens、创建类：Board 用户；
- Agent：只读（或只能通过工具读 Lens 定义，不创建）。
- 如果“创建新的类”指新的元素类型/本体类型，应在项目图谱里做，不在插件里做。

## 9. 与审计/Workflow 的关系

同一个底座，不同 Lens：

- **Evidence Lens**（后续）：指标 → 图谱元素 → testcase → 映射；
- **Workflow Lens**：behavior 子图 → 泳道/时间线；
- **Business Lens**：角色/服务/流程的业务视角；
- **Org Lens**：Agent/team/reportsTo；
- **Observed Lens**（后续）：Paperclip issue/handoff → 实际协作流程；
- **Coverage Lens**：缺失、过期、断裂。

Lens 是配置，不是每个项目写代码。

## 10. 分阶段

**Phase 1**

- 同步（无 Agent）+ 快照 + 索引；
- Lens Gallery（cards + 类 + 创建/删除）；
- Lens Builder（选元素/关系 + Architecture/Business/Matrix/Table）；
- Lens Viewer（自动布局 + 拖拽位置 + 详情 + provenance）；
- 引用断裂、stale、dirty。

**Phase 2**

- 更多预设、跨项目 Lens、Lens 复制/模板、分享/导出；
- Evidence Lens；
- K 映射/Overlap。

**Phase 3**

- Observed Workflow Lens；
- K 的语义提取 artifact；
- 只读分享链接/证据包。

## 11. 未定问题

1. “创建新的类”是 Lens 分类，还是图谱里的新元素类型？
2. Lens 是单项目为主，还是 Phase 1 就支持跨项目组合？
3. Lens 默认跟随 current 并显示 drift，还是必须钉住 commit？
4. 预置风格四个够不够：Architecture / Business / Matrix / Table？
5. 关系选择：只允许选“已选元素之间的图谱关系”，不能画新边；确认？
6. 同步：接受每个环境手工配一次 SSH 坐标，还是要求 zero-config？
7. 分享：Phase 1 只做公司内只读页面，导出/对外分享放 Phase 2？

## 12. 当前状态

- 未定稿、未实现；
- 未创建插件代码；
- 未修改 `packages/shared` 或 `ui/src`；
- 未提交。
