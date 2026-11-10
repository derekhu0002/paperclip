---
name: org-rsi
description: Paperclip 组织级 RSI 工作手册：组织记分卡六项指标口径、变异记录 schema、留出评估电池执行流程与反退化规则。用于威胁情报中心「组织进化」子组织的感知/变异/选择/遗传四环。
---

# org-rsi

## 何时使用
- 产出组织记分卡（效率质量）
- 提出组织变异（组织架构师）
- 独立复核变异（独立审计）
- 编排进化周期（组织进化负责人）

## 1. 记分卡六项指标（口径固定）
1. lead time：todo→done 中位时长（小时），附均值与 n。
2. 返工率：reopen 次数 / 进入过 done 的 issue 数。
3. blocked/死锁率：期末 blocked / 未归档总数；单列无 first-class blocker 的 blocked。
4. 空转 wake 比：无 issue 推进且无文件变更的 run / 总 run。
5. 每交付成本：期间成本 / 期间 done 数（USD）。
6. 审批驳回率：rejected / 已决 approval。

## 2. 数据端点
- GET /api/companies/:companyId/issues
- GET /api/companies/:companyId/heartbeat-runs
- GET /api/companies/:companyId/dashboard
- GET /api/companies/:companyId/approvals
- GET /api/companies/:companyId/costs/summary
- GET /api/companies/:companyId/costs/by-agent

## 3. 变异记录 schema
mutation_id / tier(A|B|C) / target / diff / hypothesis / expected_metric_delta / rollback_point / evidence / decision_criteria / status。

## 4. 留出评估电池
private 项目「组织进化评估电池」：EB-1 只读巡检、EB-2 工作区外读取故障复现、EB-3 交付真实性。
流程：核对判据 → 全部执行 → 夹带检查 → pass/fail/inconclusive + 证据。

## 5. 反退化清单
- 单周期单变异（归因干净）。
- 不得修改自己被度量的验收标准。
- 不得自批；C 级上升人类。
- 变更必须事前写回滚点与保留阈值。
- 用“每单位结构变更的交付增量”记账，防结构抖动。

## 6. 变异分级
A 参数（模型/heartbeat/prompt/skill/并发）自动应用；B 编制（hire/fire/项目/汇报）需人类批准；C 身份（目标/范围/权限/预算）仅人类。
