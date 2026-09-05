# 04: 故障注入验证矩阵

**What to build:** 一套系统化的故障注入测试矩阵，覆盖 release-gates.md 中定义的全部故障场景。每项故障有可重复的脚本、期望结果和证据输出。故障注入脚本产出进入 release-evidence/failure-injection/ 目录。矩阵覆盖：Renderer Kill、Electron Main Kill、Agent Manager Kill、App Server Kill、Provider SSE 中断、重复 Runtime Event、SQLite Migration 失败、Event 与 Artifact 不一致、Ticket/Spec 外部修改、Target Branch 前进/Dirty、Skill 更新失败/离线。

**Blocked by:** 03 — 持久化恢复协调（需要恢复能力到位后才能验证故障恢复）

**Status:** ready-for-agent

- [ ] Renderer Kill → Task 继续，重载后恢复 Projection
- [ ] Electron Main Kill → Agent Manager 中断活动 Turn、落盘并退出
- [ ] Agent Manager Kill → 重启后协调 DB、Runtime 和 Git 现场
- [ ] App Server Kill → 仅影响对应 Provider Profile；不重发不确定输入
- [ ] Provider SSE 中断 → Stage Budget 内恢复或进入 USER_INPUT
- [ ] 重复 Runtime Event → 幂等去重
- [ ] SQLite Migration 失败 → 回滚并进入只读 Recovery Mode
- [ ] Event 与 Artifact 不一致 → 显式协调或 UNCERTAIN
- [ ] 每项故障有可重复脚本和 release-evidence/failure-injection/ 证据输出
- [ ] verify.ps1 新增 --gate m2-fault-injection 参数，执行全部故障矩阵检查
