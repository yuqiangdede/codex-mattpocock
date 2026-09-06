# 06: Independent Final Review

**What to build:** 独立的 Final Review Session，使用与实施 Session 隔离的 Runtime Session 和两个 Reviewer Subagent（uncommittedChanges + custom instructions）。Review 产出可追踪的 Review Finding，每个 Finding 包含严重度（Critical / High / Medium / Low）以及对应的 Spec 条目、Ticket、文件位置和证据。Critical 或 High Finding 默认阻止最终 Gate；用户可以显式忽略但必须保存理由。Review Finding 可转化为修订 Ticket，进入 DAG 调度。

**Blocked by:** 02 — Runtime Session 生命周期管理（需要真实 Codex Turn 驱动 Reviewer）
02 — Ticket DAG 调度与 Child Task（需要 DAG 支持才能把 Finding 转为修订 Ticket）

**Status:** completed

- [x] Final Review 使用独立 Runtime Session，与实施 Session 隔离 — `runReviewer` 双 Session 验证
- [x] 启动两个 Reviewer Subagent：uncommittedChanges 和 custom instructions — workflow.mjs test 4 验证 `new Set(sessions).size === 2`
- [x] Reviewer 产出 Review Finding，包含严重度和对应 Spec/Ticket/文件/证据 — Finding 结构含 severity/specItem/ticketId/file/line/evidence
- [x] Critical/High Finding 阻止最终 Gate 通过 — `review = 'blocked'` 验证
- [x] 用户可显式忽略 Critical/High Finding，但必须保存忽略理由 — `ignoreFinding('f1', ' ')` 抛 `/理由/`；`ignoreFinding('f1', '本次验收已有真实断言')` 通过
- [x] Review Finding 可转化为修订 Ticket，进入 DAG 调度 — `reviseFinding('f1', 'fix-f1')` → `frontier.includes('fix-f1')`
- [x] Review Session 可被取消，取消后 Task 标记为需要人工介入 — 取消路径在 workflow 层已实现
- [x] Review 完成后产出 Completion Evidence（验证结果与验收标准的对应关系） — `verify()` + `review()` 产出可持久化状态

验证证据：`logs/workflow-final.log`（test 4 PASS，沙箱外）、`tests/integration/workflow.mjs`。
