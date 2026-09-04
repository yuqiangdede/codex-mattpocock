# 将 Requirement Delivery 设为唯一 MVP Task

MVP 对用户只提供 Requirement Delivery Task，不提供 Quick Task 或任意 Workflow 编辑器。添加 Project 只执行只读 Project Scan，并以稳定 Project Identity 关联规范路径与 Git Identity；创建 Task 后才生成带稳定短 ID 的 Artifact 路径和 Integration Worktree。Spec 与 Ticket 可在 Workbench 内编辑预览，也可在外部编辑器修改，统一由 File Watcher 和内容哈希驱动 Gate 与 STALE 状态。
