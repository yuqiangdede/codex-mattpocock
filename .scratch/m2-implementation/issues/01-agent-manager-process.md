# 01: Agent Manager 进程化与 Event Store 接管

**What to build:** 把 M1 中直接写在 Electron Main 进程里的 IPC handler、DB 操作和 Turn 模拟逻辑迁移到独立的 Utility Process（Agent Manager）。Main 进程退化为 IPC 路由器和窗口管理器，不再直接持有 DB 写连接或业务逻辑。Agent Manager 拥有唯一的 SQLite 写连接，通过 MessagePort 或 IPC 与 Main 通信。迁移后 M1 的 8 步纵向切片（Project Scan → Task → Worktree → Turn → Approval → Diff → Verify → Recovery）仍然全部可跑，冒烟测试退出 0。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Agent Manager 作为 Utility Process 启动，持有唯一 WorkbenchDatabase 写连接
- [ ] Main 进程不再直接 import @workbench/storage 或操作 DB；所有 DB 操作通过 Agent Manager 消息通道
- [ ] M1 的全部 8 步切片在进程化后仍然通过（E2E 脚本 18/18 PASS）
- [ ] Electron 冒烟测试（WORKBENCH_SMOKE_TEST=1）在进程化后退出 0
- [ ] Agent Manager 进程崩溃后 Main 进程能检测并报告（不需要自动恢复，03 工单负责恢复）
- [ ] Preload API 接口不变，Renderer 无感知后端进程化
