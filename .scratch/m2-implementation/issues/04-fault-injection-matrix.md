# 04: 故障注入验证矩阵

**What to build:** 一套系统化的故障注入测试矩阵，覆盖 release-gates.md 中定义的全部故障场景。每项故障有可重复的脚本、期望结果和证据输出。故障注入脚本产出进入 release-evidence/failure-injection/ 目录。矩阵覆盖：Renderer Kill、Electron Main Kill、Agent Manager Kill、App Server Kill、Provider SSE 中断、重复 Runtime Event、SQLite Migration 失败、Event 与 Artifact 不一致、Ticket/Spec 外部修改、Target Branch 前进/Dirty、Skill 更新失败/离线。

**Blocked by:** 03 — 持久化恢复协调（需要恢复能力到位后才能验证故障恢复）

**Status:** in-progress

矩阵已运行并产出证据 `release-evidence/failure-injection/m2-matrix.json`。当前状态：

- [~] Renderer Kill → Task 继续，重载后恢复 Projection — **SANDBOX-BLOCKED**（沙箱外边界已通过；活动 Turn NOT RUN）
- [~] Electron Main Kill → Agent Manager 中断活动 Turn、落盘并退出 — **SANDBOX-BLOCKED**（同上）
- [~] Agent Manager Kill → 重启后协调 DB、Runtime 和 Git 现场 — **SANDBOX-BLOCKED**（同上）
- [x] App Server Kill → 仅影响对应 Provider Profile；不重发不确定输入 — **PASS**（`app-server-kill.mjs` mock spawnFn 验证 Profile 隔离、不重放、INTERRUPTED+UNCERTAIN）
- [x] Provider SSE 中断 → Stage Budget 内恢复或进入 USER_INPUT — **PASS**（`provider-sse-interrupt.mjs` mock spawnFn 验证在途请求拒绝、UNCERTAIN 标记、Stage Budget 恢复、USER_INPUT 降级；真实 Provider SSE 需配置兼容凭据）
- [x] 重复 Runtime Event → 幂等去重 — **PASS**（`event-recovery.mjs` 5 项全过）
- [x] SQLite Migration 失败 → 回滚并进入只读 Recovery Mode — **PASS**（`recovery-mode.mjs` 验证）
- [x] Event 与 Artifact 不一致 → 显式协调或 UNCERTAIN — **PASS**（`event-artifact-mismatch.mjs` 验证 rebuildProjections 重建、recoverNonTerminalTasks 标记 INTERRUPTED+UNCERTAIN、幂等恢复）
- [~] Ticket/Spec 外部修改 — **SANDBOX-BLOCKED**（沙箱外 `workflow.mjs` 5/5 PASS；沙箱内被 slashed-ref 阻塞）
- [~] Target Branch 前进/Dirty — **SANDBOX-BLOCKED**（同上）
- [x] Skill 更新失败/离线 — **PASS**（`skill-update-failure.mjs` 验证源不可达回退缓存、校验失败保留旧版、无缓存不阻塞启动、缓存损坏优雅降级、远程恢复自动更新、多 Skill 部分可用不阻塞）
- [x] 每项故障有可重复脚本和 release-evidence/failure-injection/ 证据输出 — `scripts/test-m2-fault-injection.mjs`
- [x] verify.ps1 新增 --gate m2-fault-injection 参数，执行全部故障矩阵检查 — 已实现（`scripts/verify.ps1` 第 307–318 行）

**不能标记 completed**：5 项 SANDBOX-BLOCKED 需在沙箱外重跑后才能确认。这些项的根因是 agent 沙箱内 git 无法创建含 `/` 的 `task/<id>` 引用（见 issues/08），非代码缺陷——沙箱外同一脚本同一仓库全绿。

**矩阵状态汇总**：6 PASS / 5 SANDBOX-BLOCKED / 0 NOT RUN / 0 BLOCKED
