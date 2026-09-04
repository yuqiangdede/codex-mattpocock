# 持久化 Normalized Event 并重建 Projection

Agent Manager 以至少一次语义把带稳定去重键的版本化 Normalized Event 追加到 SQLite，再通过幂等更新构建可重建的 UI Projection；事件、Projection 和 Attention Outbox 在同一短事务中提交，Renderer 和 Electron Main 不直接访问数据库。Codex Rollout 仍是 Runtime Session 历史来源，产品事件是 Task 状态来源；大型 Tool Output 存入有大小上限的内容文件，Event 只保存摘要和引用，原始 Runtime Event 必须脱敏和截断。数据库迁移前执行一致性检查和 Online Backup，失败时进入只读 Recovery Mode；应用启动后对非终态 Task 核对数据库、Codex Thread 和 Git/Worktree 现场，不静默重发输入。
