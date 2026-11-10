# AIC 组织级 RSI 子组织（复用式，2026-11-10）

## 复用映射（0 新增 Agent / 0 新增业务项目）

| RSI 角色 | 复用 Agent | ID | 说明 |
|---|---|---|---|
| 子组织负责人 | 交付经理 · aic-command-delivery | `a5d8356a-c714-485d-a992-bb64ce1883e8` | 管节奏/跟踪，明确不参与提案 |
| 效率质量 | 效率质量 Agent · aic-efficiency | `4885363c-13fb-4972-a609-c1095985109f` | 本职度量整组织 |
| 组织架构师 | 知识管理员 · aic-command-knowledge | `60f313f1-71c7-454f-86dd-b3dc81818d72` | 本就提出方法论提案并接受蓝军审查 |
| 独立审计 | 蓝军主审 · aic-command-blue-lead | `b2dd3c23-5050-43ea-9d00-e32348e86693` | 独立挑战方，持否决权 |

- 项目：复用「效率质量」`721297a7-4dbd-4f23-aff7-498770496e8e`（parent=咨询指挥部），lead 改为交付经理。
- 仓库/环境：复用 `aic-efficiency` / `a22ad7ca-82fe-4351-bdcf-3631e53591d0`（已有 design/KG）。
- 技能：`company/66563a2a-3d6c-444c-90cb-e77ade723e96/org-rsi`（AIC 公司级）。
- 汇报线：效率质量、知识管理员 → 交付经理；蓝军主审 **保持向首席顾问汇报**（保住其全组织独立挑战权）。首席顾问直属 active 8 → 6。
- 唯一新增：private 项目「组织进化评估电池」`03e5fbb9-2868-4838-9d3f-b0c695843d21`（parent=效率质量，仅蓝军主审可读）+ 2 条 routine。

## RSI 附加职责（追加进各自 AGENTS.md）

### 交付经理（子组织负责人）
1. 每周确认效率质量产出组织记分卡；每月确认只产生 1 条变异（知识管理员）。
2. 每条变异必须经蓝军主审复核后才可 applied/保留；不得干预复核结论、不得自批。
3. 维护基因组账本（company export 落 git）。
4. C 级变更上升首席顾问与人类。

### 效率质量（metrics owner）
沿用既有度量职责，新增六项 RSI 指标（见 org-rsi skill）；只度量、不决策、不自评。

### 知识管理员（architect）
每周期最多 1 条变异，写 mutation record；A 参数直接应用，B 需批准，C 仅人类；不得自批。

### 蓝军主审（verifier）
用 private 电池独立复核（pass/fail/inconclusive + 证据）；检查夹带；否决权与独立性不变。

## 坑（务必记住）

**给「存在 unpriced 记账」的 Agent 设置 hard-stop 预算策略，会直接触发 `budget_override_required` 硬事件**：
- 现象：PATCH `budgetMonthlyCents` 后，Agent `paused`（`pause_reason=budget`, `lifecycle_holds=[budget]`），并生成 pending approval；被指派 issue 变 `blocked`。
- 本项目实例：效率质量 Agent（spent 29.24 / 预算 15000 分）仍被暂停，说明触发原因是 unpriced accounting，而非超额。
- 处置：`PATCH /api/agents/:id {budgetMonthlyCents:0}` 停用策略 → `POST /api/approvals/:id/approve` → `POST /api/agents/:id/resume` → `PATCH /api/issues/:id {status:'todo'}` 解除 blocked。
- 结论：**AIC 这类存在 unpriced 记账的组织，先清理记账口径再开硬停预算**；本次四个 Agent 的 agent 级预算策略已置 0（is_active=false）。
