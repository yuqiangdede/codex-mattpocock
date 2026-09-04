# 每个 Provider Profile 运行一个 App Server

每个已启用的 Provider Profile 对应一个由 Agent Manager 监督的 Codex App Server 进程，该 Profile 下的多个 Task 共享该进程。这个边界允许不同 Provider 并行运行，同时避免每个 Task 单独启动 Runtime；进程崩溃后只恢复受该 Profile 影响的 Runtime Session，状态不确定的 Turn 不会被静默重发。
