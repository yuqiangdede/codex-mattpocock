# 03: 持久化恢复协调

**What to build:** 当 Agent Manager 进程被杀死或 Electron 崩溃后重启，非终态 Task 从 SQLite 事件存储重建状态。Agent Manager 重启时读取全部 Task 和 Event，重建 Projection 和 Attention State。已发出但未确认的用户输入标记为 Uncertain Input，不自动重放——需要用户决定检查、重发或丢弃。重复到达的 Runtime Event 幂等去重，不产生重复 Timeline 条目、重复 Approval 或重复状态迁移。大型 Tool Output 不写入 SQLite BLOB，Renderer 只加载受限 Tail。

**Blocked by:** 01 — Agent Manager 进程化

**Status:** ready-for-agent

- [ ] Agent Manager 重启后从 SQLite 重建全部 Task 状态和 Projection
- [ ] 非终态 Task（executionState=RUNNING）恢复后标记为 INTERRUPTED，等待用户决定
- [ ] Uncertain Input 列表展示给用户，用户可选择重发或丢弃
- [ ] 重复 Event（相同 id）不产生重复 Timeline 条目或重复 Approval
- [ ] 50MB Tool Output 不写入 SQLite，Renderer 只加载最后 N 行
- [ ] Renderer Kill 后重载，Task 继续运行，Projection 恢复
- [ ] Electron Main Kill 后重启，Agent Manager 落盘并恢复非终态 Task
- [ ] 恢复前后 Task ID 一致，Event 计数一致
