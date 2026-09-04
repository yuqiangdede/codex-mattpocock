# 分离 Ticket 意图与执行状态

Ticket Markdown Frontmatter 保存稳定 ID、意图、依赖、验收、验证、影响范围和 Triage Label；SQLite 保存调度、Runtime Session、执行状态和 Event Projection，不复制整份 Ticket 作为第二真相源。Artifact 通过临时文件、Flush 和同目录原子 Rename 落盘，再提交引用内容哈希的 Event；启动恢复扫描孤立文件或缺失 Event，无法自动协调时进入 `RECOVERING + UNCERTAIN`。
