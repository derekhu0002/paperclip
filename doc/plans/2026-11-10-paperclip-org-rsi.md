# Paperclip 组织级 RSI（递归自我改进）架构提案

- 状态：Draft / 首批落地中
- 日期：2026-11-10
- 作者：项目经理（project-manager-001）
- 首个落地组织：威胁情报中心（CTI，公司 `f1b9f8ac-1a4b-4d1d-a8e3-a86f2981dab6`，实例 47）
- 参考：Google 2026-10 四篇 Harness RSI 论文（Harness²、Evo²、RRSI、OO-Harness），见 `doc/plans/2026-11-10-paperclip-org-rsi-references.md`（如需单独收录）

## 1. 背景与问题

Paperclip 已经提供了完整的「组织解剖学」：

- 结构：Company（租户边界）→ Project 树 → Team（1 PM + 直属 Agent）→ Agent，单 assignee、依赖自动释放、原子 checkout。
- 运行：heartbeat（`skipTimerWhenNoActionableWork`）、routines（cron/webhook）、approvals、budget 硬停、run log。
- 自复制：`canCreateAgents` / `canCreateSkills`（标准信任 Agent 默认可自建 Agent、自写 skill）。
- 基因组：agentcompanies/v1 company package 整包 export/import（agents/skills/projects/issues/routines）。
- 记忆：每个仓库的 ArchGraph/ARGO 意图图 + T1/T2/T3 记忆 + `memory-capture`。

缺失的是「组织代谢」：组织能观测自身绩效、提出结构变异、安全验证、并把结果继承下去。没有这个闭环，所谓"自进化"只是人类手动重构。

核心命题：**在 Paperclip 的组织形态之上，为每个组织加装一条可审计、可回滚、抗过拟合的自我改进回路。**

## 2. 目标 / 非目标

目标：

- 每个组织具备感知（度量）、变异（提议）、选择（门禁）、遗传（继承）四个闭环。
- 变异以「基因组 diff」表达，可 dry-run、可回滚。
- 无金标场景下仍能产生有效变异（组织没有"正确的组织架构"标准答案）。
- 明确防止两类退化：刷分式过拟合、空转式结构抖动。

非目标：

- 不做模型微调（实例里的 Agent 运行冻结模型）。
- 不替换人类的最终否决权与身份层决策。
- 不追求"全自动自组织"。第一批是「机器提议 + 人类裁决」。

## 3. 定义：组织级 RSI

组织级 RSI = 一个持续运行的四环：

1. **感知（Sense）**：从运行证据（run log、cost、issue 周期、死锁/返工）计算组织记分卡。
2. **变异（Propose）**：产出对组织基因组的一条**单一**变异提案（假设 + 预期指标变化 + 回滚点）。
3. **选择（Gate）**：按爆炸半径分级审批，执行验证，保留或回滚。
4. **遗传（Inherit）**：把「变异 + 结果 + 判据」沉淀为可迁移的 Meta-Skill 与记忆。

一个组织"会自我进化"的判据：跑完至少一个完整周期，且第二个周期能引用了第一个周期的结论。

## 4. 四篇参考论文 → 四个机制

| 论文 | 解决的问题 | 在本提案中的机制 |
|---|---|---|
| Harness² | 无金标时如何进化 | **感知+变异**：从 trace 挖过程缺陷（空转 wake、工具失败、弯路、死锁），双轨（通用不变量 vs 领域知识）分提分验，单条证据提议 + 全局聚合裁决 |
| Evo² | 进化器自身如何进化 | **遗传**：把"什么改法有效/无效"整理为 Meta-Skill（存 skills-catalog + T2 记忆），让下一轮的提议者更强，无需微调 |
| RRSI | 防过拟合 | **选择**：限制单轮改动幅度、每条改动必须说明所解决问题、评分前查"夹带个例答案"、并用**留出集**（未暴露给被进化 Agent 的真实任务）验证泛化 |
| OO-Harness | 结构如何组织 | **组织结构**：共享基础能力（父 Project / 共享 skill）+ 专业能力（子 Project）+ PM 路由；"基础优先，专有兜底" |

一句话：**Loop Engineering 冲目标，Graph Engineering（门禁 + 留出集 + 人类否决）监管 Loop。**

## 5. 架构

```
           ┌──────────── 组织基因组（company package + ARGO KG）────────────┐
           │                                                              │
   [感知] 记分卡 routine ──► [变异] 架构师提议 mutation ──► [选择] 分级门禁 ──► 应用
           ▲                        │                         │              │
           │                        └── 证据：trace/KG ───────┘              ▼
           └──────────────── [遗传] Meta-Skill + 记忆 ◄──────── 记分卡复核 ◄──┘
```

四环落到 Paperclip 原语：

| 环 | 落地原语 | 证据来源 |
|---|---|---|
| 感知 | routine（周度）产出证据 issue；`cost_events`、`heartbeat_run_events`、`activity_log`、issue 周期 | `doc/run-log-events.md` |
| 变异 | issue（kind=mutation 提案）或插件页；引用 KG 元素 | `design/KG/SystemArchitecture.json` |
| 选择 | approvals + 分级门禁 + budget 上限；`company export` 做回滚点 | `server/src/services/company-portability.ts` |
| 遗传 | skills-catalog + T2 记忆（`memory-capture`） | `packages/skills-catalog/` |

## 6. 角色：三岗制

每个启用 RSI 的组织至少新增三个角色（均向该组织负责人汇报）：

1. **效率质量 Agent（metrics owner）**
   - 唯一职责：产出组织记分卡与异常证据；不做结构决策。
   - 禁止：给自己的指标打分（自评）；禁止修改被自己度量的 Agent 的验收标准。

2. **组织架构师 Agent（mutation proposer）**
   - 唯一职责：每周期最多提出 **1 条** 变异，含假设、预期指标变化、回滚点、引用 KG。
   - 禁止：同周期提出多条互相干扰的变异（保证归因干净）。

3. **独立审计 Agent（verifier）**
   - 唯一职责：持有留出评估电池，独立复核变异是否真正生效、是否夹带个例。
   - 约束：其评估 issue 不对被进化的 Agent 可见。

## 7. 变异分级与门禁

| 级 | 范围 | 审批 | 回滚 |
|---|---|---|---|
| **A（参数）** | 模型、heartbeat 间隔、prompt/skill 文本、并发 | 预算/权限包络内自动应用 | git revert / PATCH 回退 |
| **B（编制）** | hire/fire、Project/Team 重排、reportsTo | 机器提议 + 人类批准 | `company import` 或反向 PATCH |
| **C（身份）** | 公司目标、产品范围、权限模型、预算总额 | 仅人类 | 不自动回滚 |

门禁硬规则：

- 单周期单变异（RRSI 的幅度控制）。
- 任何变异必须写明"要解决的 trace/KG 证据"。
- 变异不得修改自己的验收标准；审计电池对被进化方不可见。
- 效果回滚判据必须事前写明（含"正常波动"区间），避免事后解释。

## 8. 工件

1. **组织记分卡（Scorecard）**：lead time、返工率、blocked/死锁率、空转 wake 比、每交付成本、审批驳回率。由周度 routine 生成。
2. **变异记录（Mutation Record）**：id、级别、改动 diff、假设、预期指标、回滚点、复核结论。
3. **基因组账本（Genome Ledger）**：`paperclipai company export` 定时落 git；diff 即变异史，import 即回滚。
4. **评估电池（Eval Battery）**：一批可重复的真实任务（例如只读巡检、已知故障复现），对进化方隐藏。

## 9. 与现有能力的接口

- 结构编辑：`projects.parent_project_id`、`projects.lead_agent_id`、`agents.reports_to`。
- 预算硬停：`companies.budget_monthly_cents` / `agents.budget_monthly_cents`。
- 审批：approvals 与 issue interaction（`request_confirmation`）。
- 组织 UI：插件范式 `packages/plugins/plugin-project-tree`（新页面不宜再侵入上游）。
- 记忆：ARGO KG（每个项目仓 `design/KG`）+ T1/T2/T3。

## 10. 验收（可执行 GIVEN-WHEN-THEN）

1. **三岗就位**
   GIVEN 一个启用 RSI 的组织，WHEN 查询其 Agent 列表，THEN 存在效率质量/组织架构师/独立审计三岗，且均 `reportsTo`=组织负责人、`lifecycle_state=ready`。

2. **记分卡可产出**
   GIVEN 周度记分卡 routine 已启用，WHEN 触发一次，THEN 生成一条包含全部 6 项指标的证据 issue，并指派给效率质量 Agent。

3. **单周期单变异**
   GIVEN 组织架构师在一个周期内，WHEN 提交变异，THEN 只存在 1 条 open 的 mutation 记录；重复提交被拒绝或合并。

4. **变异可回滚**
   GIVEN 一条已应用的 A/B 级变异，WHEN 执行回滚，THEN 基因组恢复到变异前版本（`company export` diff 为空）。

5. **留出集校验**
   GIVEN 审计电池包含 N 条对被进化方不可见的任务，WHEN 复核一个变异，THEN 至少跑完 N 条且结果记录在 mutation 记录中。

6. **反自评**
   GIVEN 任一 Agent，WHEN 尝试编辑自己被度量指标的验收标准，THEN 请求被拒绝或标记为需人类批准。

## 11. 反退化与风险

- **自欺（reward hacking）**：Agent 互评、自我宣告完成。对策：验收外部化（DoD、真实 journey、GIVEN-WHEN-THEN 可执行）、审计独立、人类否决。
- **过拟合**：只在高频任务上变好。对策：RRSI 式留出集 + 改动幅度限制。
- **结构抖动**：频繁改名/拆合但不交付。对策：单周期单变异 + "每单位结构变更的交付增量"记账。
- **归因失败**：多变异同时上线。对策：一周期一变。
- **成本**：感知与审计本身耗 token。对策：heartbeat `skipTimerWhenNoActionableWork` + 周/月粒度，不用实时循环。

## 12. 落地路线

阶段 1（本提案配套）：在威胁情报中心落地三岗 + 组织进化项目 + 周度记分卡 + 月度进化周期 + 评估电池 + 基因组账本。
阶段 2：跑满两个周期，验证"引用上一周期结论"。
阶段 3：把经验抽象为 `org-rsi` skill，复制到其他组织。

## 13. 开放问题

- 组织级 eval 电池如何避免被进化方"看见"？（当前靠指派隔离 + 不写进共享文档）
- Meta-Skill 的版本与回滚如何治理？
- 跨组织迁移经验时，如何防止把一个组织的过拟合结论带到另一个组织？
