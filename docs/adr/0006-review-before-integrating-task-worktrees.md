# 审查后再集成 Task Worktree

每个 Requirement Delivery Task 都在独立 Parent Integration Worktree 中实施，即使当前没有并行 Ticket；非 Git Project 只能完成 Project Scan、需求澄清和 Spec，不能进入实施。Worktree 只能从用户明确选择的 Commit 或 Branch 创建，不自动复制、Stash 或改写未提交修改。Agent 可以在隔离分支创建 Commit，但不能自动 Merge 或 Push；逐文件接受仅记录 Review 选择，用户确认最终集成时才一次性 Merge、Cherry-pick 或导出选定 Patch。集成前重新验证目标分支、Dirty 状态、Integration Candidate Commit、Spec 哈希和必需测试，任一变化都停止自动集成并重新 Review。Worktree 在集成后继续保留，归档 Task 时才提示清理。
