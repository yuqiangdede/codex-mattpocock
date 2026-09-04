# 固定 Workflow 输入并在不确定时停止

Task 固定 Workflow Definition、Skill Snapshot、Provider Profile、模型、Spec 哈希和每个 Child Task 的 Ticket Snapshot。Provider 失败不会静默切换模型，Locked Context 超出窗口不会静默截断，指令冲突或 Skill 依赖缺失不会自动联网修复；系统暂停并展示证据，由用户决定迁移、缩小范围或批准环境变更。中断 Child Task 只停止 Runtime 执行并保留 Partial Diff、日志和 Worktree，不自动回滚或删除。
