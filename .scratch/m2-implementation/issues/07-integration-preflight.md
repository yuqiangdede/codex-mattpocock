# 07: Integration Preflight

**What to build:** 集成前检查（Preflight）在 Child Task 修改汇入 Parent Integration Branch 之前执行，阻止不安全的集成。Preflight 检查：Dirty Target（目标分支有未提交改动）、过期 Candidate（Integration Candidate 基于的 Spec/Ticket 已被外部修改）、变化后的 Spec（Spec 哈希与 Task 创建时不一致）、失效测试结果（验证结果基于过期的 Worktree 状态）。用户可以选择 Merge、Cherry-pick 或 Patch 方式集成，系统不会自动 Push。

**Blocked by:** 05 — Ticket DAG 调度与 Child Task（需要 DAG 和 Child Task 才能做集成）
06 — Independent Final Review（需要 Review 通过后才能集成）

**Status:** ready-for-agent

- [ ] Preflight 检查 Dirty Target：目标分支有未提交改动时阻止集成
- [ ] Preflight 检查过期 Candidate：Integration Candidate 基于的 Spec/Ticket 已被修改时阻止
- [ ] Preflight 检查 Spec 哈希：Spec 在 Task 创建后被修改时阻止
- [ ] Preflight 检查失效测试结果：验证结果基于过期的 Worktree 状态时阻止
- [ ] 用户可选择 Merge、Cherry-pick 或 Patch 集成方式
- [ ] 系统不自动 Git Push
- [ ] Integration Candidate 汇总已选 Child Task 修改
- [ ] Preflight 报告产出可审查的证据文件
