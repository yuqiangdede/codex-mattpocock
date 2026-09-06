# 05: Ticket DAG 调度与 Child Task

**What to build:** workflow 包实现 Requirement Delivery Workflow 的核心调度：从已批准 Spec 拆出 Ticket，每个 Ticket 声明 blocking edges（依赖其他 Ticket 才能开始）。DAG 环检测有效——如果 Ticket 依赖形成环，拒绝并报告。Child Task 按依赖调度：只有当 Ticket 的全部 blocker 完成后才能开始执行，每个 Child Task 在独立 Worktree Commit。Child Task 失败只阻塞依赖后继，不影响无关 Ticket。用户可以在 UI 中看到 Ticket DAG 的拓扑结构和当前 frontier（blocker 全部完成的可执行 Ticket）。

**Blocked by:** 02 — Runtime Session 生命周期管理（需要真实 Codex Turn 驱动 Ticket 执行）

**Status:** completed

- [x] workflow 包实现 Ticket 创建、blocking edges 声明和 DAG 拓扑构建 — `packages/workflow/src/index.ts` DeliveryWorkflow
- [x] DAG 环检测：如果 Ticket 依赖形成环，拒绝并报告参与环的 Ticket ID — workflow.mjs test 1 验证
- [x] Frontier 计算：blocker 全部完成的 Ticket 标记为可执行 — `getState().frontier` 验证
- [x] Child Task 创建：从 Parent Task 派生，在独立 Worktree Commit — `runTicket` + `git worktree add` 验证
- [x] Child Task 按依赖调度：blocker 未完成的 Ticket 不能开始 — workflow.mjs test 5 验证 `Ticket 不在 frontier`
- [x] Child Task 失败只阻塞依赖后继，不影响无关 Ticket — workflow.mjs test 5 验证 F 失败不阻塞 A/B
- [x] Ticket 使用稳定 ID，标题与文件名不是身份 — `ticket.id` 全程作为身份键
- [x] Triage Label 符合规则（ready-for-agent / needs-info / ready-for-human） — ticket.label 字段验证

验证证据：`logs/workflow-final.log`（5/5 PASS，沙箱外真实临时 Git worktree）、`tests/integration/workflow.mjs`。
