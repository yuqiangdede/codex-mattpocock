# 02: Codex Runtime Session 生命周期管理

**What to build:** 用真实的 Codex App Server 调用替换 M1 中的模拟 Turn 逻辑。runtime-codex 包实现：启动和停止固定 Codex App Server 进程（每个 Provider Profile 一个）、initialize 握手、Thread 创建与恢复、Turn start/steer/interrupt、Approval 请求转发到 Renderer。用户在 Composer 输入 prompt 后，Agent Manager 通过 runtime-codex 启动真实 Codex Turn，Codex 产出的代码修改写入 Worktree，Approval 请求从 Codex 转发到 Renderer 面板，用户批准后 Codex 继续执行。Timeline 显示真实流式输出。

**Blocked by:** 01 — Agent Manager 进程化

**Status:** ready-for-agent

- [ ] runtime-codex 包实现 Codex App Server 进程启动与停止（stdio JSONL）
- [ ] initialize 握手成功，Schema Hash 与 Spike 记录一致
- [ ] Thread 创建（thread/start）和恢复（thread/resume）可用
- [ ] Turn start 产出真实流式输出，Timeline 显示 Agent 消息
- [ ] Codex Approval 请求转发到 Renderer 面板，用户 Approve/Deny 后 Codex 继续或中止
- [ ] Codex 产出的代码修改写入 Worktree，getDiff 显示真实 Diff
- [ ] Turn interrupt 可安全中止正在执行的 Turn
- [ ] M1 的 m1-fixture（hello() 函数）在真实 Codex Turn 下仍然通过 npm test
- [ ] Provider Secret 通过受控认证 Helper 传递，不泄露到 Renderer 或 Project Shell
