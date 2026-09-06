# M2 持久化与交付工作流验证

## 工单状态总览

| # | Title | Status | 证据 |
|---|-------|--------|------|
| 01 | Agent Manager 进程化与 Event Store 接管 | completed | `validation-01.md` |
| 02 | Codex Runtime Session 生命周期管理 | completed | `validation-02.md` |
| 03 | 持久化恢复协调 | completed | 本文档 + `event-recovery.mjs` + `persistence-recovery.mjs` + `recovery-mode.mjs` + `interrupt-transaction.mjs` |
| 04 | 故障注入验证矩阵 | in-progress | `release-evidence/failure-injection/m2-matrix.json`（2 PASS / 5 SANDBOX-BLOCKED / 4 NOT RUN） |
| 05 | Ticket DAG 调度与 Child Task | completed | `logs/workflow-final.log`（5/5 PASS，沙箱外） |
| 06 | Independent Final Review | completed | `logs/workflow-final.log`（test 4 PASS，沙箱外） |
| 07 | Integration Preflight | completed | `logs/workflow-final.log`（test 2+3 PASS，沙箱外） |

## 已通过

- `node node_modules/typescript/bin/tsc --build`
- `node node_modules/electron-vite/bin/electron-vite.js build`
- `node tests/integration/event-recovery.mjs`：事件幂等、Projection 重建、RUNNING 恢复、Uncertain Input、Runtime 身份及 50MB Tool Output 旁路。
- `node tests/integration/recovery-mode.mjs`：不支持数据库版本进入只读 Recovery Mode，原数据可读，写入拒绝。
- `node tests/integration/persistence-recovery.mjs`：幂等去重、Projection 重建、非终态恢复、Pending Input 流转、50MB 旁路、重启 Task ID/Event 计数一致、runtime_thread_id 落盘。
- `node tests/integration/interrupt-transaction.mjs`：中断状态与事件同事务提交；事件失败时状态和 Projection 回滚。
- `node scripts/test-service-runtime-port.mjs`：发送前落盘、失败不确定、显式重发/丢弃、重复 Runtime Event 与完成通知竞态。
- `node tests/integration/workflow.mjs`（沙箱外）：5/5 子测试通过，真实临时 Git worktree、DAG 环检测/frontier、Candidate、Review、Preflight 和 merge/cherry-pick/patch。证据：`logs/workflow-final.log`。
- `scripts/test-agent-manager.mjs`：真实 Utility Process / Renderer Kill / Manager Kill / Main Kill 的现有边界通过；新恢复 fixture 验证二次重启不重放输入。

## 04 故障矩阵当前状态

| 场景 | 状态 | 说明 |
|---|---|---|
| 重复 Runtime Event | **PASS** | Storage 幂等去重、ID 冲突拒绝、重建不复制、中断恢复可重复、50MB 旁路、恢复快照 |
| SQLite Migration 失败 | **PASS** | user_version=999 进入只读 Recovery Mode，保留数据并拒绝写入 |
| Renderer Kill | SANDBOX-BLOCKED | 沙箱内 git 无法创建 task/<id> 分支；沙箱外边界已通过；活动 Turn NOT RUN |
| Electron Main Kill | SANDBOX-BLOCKED | 同上 |
| Agent Manager Kill | SANDBOX-BLOCKED | 同上 |
| Ticket/Spec 外部修改 | SANDBOX-BLOCKED | 沙箱外 workflow.mjs 5/5 PASS；沙箱内被 slashed-ref 阻塞 |
| Target Branch 前进/Dirty | SANDBOX-BLOCKED | 同上 |
| App Server Kill | NOT RUN | 尚无 Profile 隔离强杀与不重放验收脚本 |
| Provider SSE 中断 | BLOCKED/NOT RUN | 未配置兼容的真实 Provider 与凭据 |
| Event 与 Artifact 不一致 | NOT RUN | 尚无 Event/Artifact 协调器与故障注入 |
| Skill 更新失败/离线 | NOT RUN | 尚无最后验证 Bundle 回退故障注入 |

## 尚未通过或未运行

`scripts/test-m2-fault-injection.mjs` 是严格门禁，活动 Provider Turn、Provider SSE 中断、App Server Kill、Event/Artifact 外部不一致及 Skill 离线更新仍标记 `NOT RUN` 或 `BLOCKED`；SANDBOX-BLOCKED 项需在沙箱外重跑确认；因此 M2 故障矩阵整体不能宣称 PASS。真实 Codex Turn 仍需要配置 Provider 凭据。

未执行：提交、推送、合并到 `main`、生产安装包和人工 UI 验收。
