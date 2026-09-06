# 04: 故障注入验证矩阵

**What to build:** 一套系统化的故障注入测试矩阵，覆盖 release-gates.md 中定义的全部故障场景。每项故障有可重复的脚本、期望结果和证据输出。故障注入脚本产出进入 release-evidence/failure-injection/ 目录。矩阵覆盖：Renderer Kill、Electron Main Kill、Agent Manager Kill、App Server Kill、Provider SSE 中断、重复 Runtime Event、SQLite Migration 失败、Event 与 Artifact 不一致、Ticket/Spec 外部修改、Target Branch 前进/Dirty、Skill 更新失败/离线。

**Blocked by:** 03 — 持久化恢复协调（需要恢复能力到位后才能验证故障恢复）

**Status:** in-progress

矩阵已运行并产出证据 `release-evidence/failure-injection/m2-matrix.json`。当前状态：

- [x] 重复 Runtime Event → 幂等去重 — **PASS**（`event-recovery.mjs` 5 项全过）
- [x] SQLite Migration 失败 → 回滚并进入只读 Recovery Mode — **PASS**（`recovery-mode.mjs` 验证）
- [~] Renderer Kill → Task 继续，重载后恢复 Projection — **SANDBOX-BLOCKED**（沙箱外边界已通过；活动 Turn NOT RUN）
- [~] Electron Main Kill → Agent Manager 中断活动 Turn、落盘并退出 — **SANDBOX-BLOCKED**（同上）
- [~] Agent Manager Kill → 重启后协调 DB、Runtime 和 Git 现场 — **SANDBOX-BLOCKED**（同上）
- [ ] App Server Kill → 仅影响对应 Provider Profile；不重发不确定输入 — **NOT RUN**
- [ ] Provider SSE 中断 → Stage Budget 内恢复或进入 USER_INPUT — **BLOCKED/NOT RUN**
- [ ] Event 与 Artifact 不一致 → 显式协调或 UNCERTAIN — **NOT RUN**
- [~] Ticket/Spec 外部修改 — **SANDBOX-BLOCKED**（沙箱外 `workflow.mjs` 5/5 PASS；沙箱内被 slashed-ref 阻塞）
- [~] Target Branch 前进/Dirty — **SANDBOX-BLOCKED**（同上）
- [ ] Skill 更新失败/离线 — **NOT RUN**
- [x] 每项故障有可重复脚本和 release-evidence/failure-injection/ 证据输出 — `scripts/test-m2-fault-injection.mjs`
- [ ] verify.ps1 新增 --gate m2-fault-injection 参数，执行全部故障矩阵检查 — 尚未实现

**不能标记 completed**：App Server Kill、Provider SSE 中断、Event/Artifact 不一致、Skill 离线仍为 NOT RUN/BLOCKED；SANDBOX-BLOCKED 项需在沙箱外重跑后才能确认。
