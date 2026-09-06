# Independent Standards / Spec Review

**Baseline:** `dd9a711`  
**Date:** 2026-09-06  
**Scope:** `packages/storage/src/index.ts`, `packages/agent-manager/src/service.ts`, `packages/agent-manager/src/codex-event-bridge.ts`, `packages/workflow/src/index.ts`, `apps/desktop/preload/src/index.ts`, `apps/desktop/renderer/src/index.tsx`  
**Spec sources:** `docs/testing/release-gates.md` (Gate 2 + Gate 3 + 故障注入矩阵), `CONTEXT.md`, `docs/adr/0007`, `0015`, `0016`, `0025`

---

## Standards

### S-1 [P1] `appendEvent` 事务内调用 `updateTaskStates`，后者开启自己的隐式语句但不在外层事务中

**File:** `packages/storage/src/index.ts:266-268`  
`appendEvent` 在 `BEGIN TRANSACTION` 内调用 `this.updateTaskStates(event.taskId, ...)`。`updateTaskStates` 执行一条独立的 `prepare().run()`。在 `node:sqlite` 中这会隐式使用当前事务，但方法本身没有事务边界声明——如果未来有人在非 `appendEvent` 上下文中调用 `updateTaskStates`，它将自动提交，破坏原子性保证。  
**Recommendation:** 将 `updateTaskStates` 标记为 `private` 或在注释中明确"必须在事务内调用"。当前代码能工作，但接口边界不够明确。

### S-2 [P2] `boundPayload` 递归处理对象和数组，但只检查顶层字符串长度

**File:** `packages/storage/src/index.ts:354-368`  
`boundPayload` 对 `string` 类型检查 64KB 阈值，然后递归处理 `Array` 和 `object`。如果一个对象包含多个中等大小字符串字段（每个 < 64KB 但总和 > 64KB），不会触发旁路。这与 Gate 2 "大型 Tool Output 不写入 SQLite BLOB" 的要求一致（单字段维度），但 `payload` 整体可能仍较大。  
**Judgement call:** 当前实现是合理的——单个大字段是主要风险场景，整体大小由 SQLite page 自然限制。记录为已知边界。

### S-3 [P2] `recoverNonTerminalTasks` 在循环中调用 `appendEvent`，每次调用独立事务

**File:** `packages/storage/src/index.ts:408-418`  
`recoverNonTerminalTasks` 遍历所有 RUNNING/RECOVERING task，对每个调用 `appendEvent`（各自 `BEGIN...COMMIT`）。如果恢复 100 个 task 且在第 50 个失败，前 49 个已提交、后 51 个未恢复。这不是 bug——恢复是幂等的，可以重跑——但不是原子恢复。  
**Judgement call:** 符合 ADR-0016 "短事务" 设计选择。幂等重跑是安全网。

### S-4 [P2] `thread/status/changed` 和 `warning` 通知映射为 `TurnStarted` 事件类型

**File:** `packages/agent-manager/src/codex-event-bridge.ts:80-100`  
`thread/status/changed` 和 `warning` 通知被映射为 `type: "TurnStarted"` 事件（payload 中用 `kind` 区分）。这意味着 Timeline 会显示多个 "TurnStarted" 条目，可能混淆 UI。  
**Recommendation:** 考虑使用独立事件类型（如 `RuntimeStatusChanged` / `RuntimeWarning`）或在 payload 中明确标注 `kind` 以让 Renderer 过滤。当前不阻塞但影响可读性。

### S-5 [P2] `sendInput` 中 `startingTasks` guard 不防止并发 `TURN_STEER`

**File:** `packages/agent-manager/src/service.ts:152-188`  
`sendInput` 用 `startingTasks` Set 防止同一 task 并发启动 Turn。但 `TURN_STEER` handler（line 321-346）不检查 `startingTasks`，如果用户在 Turn 启动过程中同时 Steer，可能产生竞态。  
**Judgement call:** `steerTurn` 调用 `runtime.steerTurn`，后者依赖 `activeTurnId`；如果 Turn 尚未启动完成，`activeTurnId` 为空会直接返回错误。实际上安全，但依赖 Runtime 层的 guard 而非 service 层的 guard。

### S-6 [P2] `close()` 中 `pendingApprovals` 遍历写入 `TurnInterrupted` 但不等待 Runtime 确认

**File:** `packages/agent-manager/src/service.ts:99-114`  
`close()` 对每个 pending approval 写入 `TurnInterrupted` 事件并设状态为 `INTERRUPTED/USER_INPUT`，然后调用 `runtime.stopAll()`。如果 `stopAll` 失败或超时，Turn 可能仍在运行但本地已标记中断。  
**Judgement call:** 符合 ADR-0015 "Main 连接丢失后安全中断" 的设计。进程退出后 Codex App Server 会被 orphaned，下次启动时 `recoverNonTerminalTasks` 会处理。

### S-7 [P2] Workflow `git()` 函数使用 `execFileSync`，30 秒超时

**File:** `packages/workflow/src/index.ts:40-42`  
所有 git 操作有 30 秒超时和 20MB maxBuffer。对于大 diff 或慢磁盘可能不够。  
**Judgement call:** MVP 阶段合理。`fingerprint` 函数读取所有 untracked 文件并 base64 编码，大仓库可能慢，但 Fixture 矩阵限定了小项目范围。

### S-8 [P2] Renderer `onEventStream` 和 `onApprovalRequest` 注册回调但不清理

**File:** `apps/desktop/renderer/src/index.tsx:64-72`  
`useEffect` 注册 `onEventStream` 和 `onApprovalRequest` 回调但不返回 cleanup 函数。React Strict Mode 下会双重注册。  
**Judgement call:** M1 MVP 阶段可接受，但应在后续修复——`ipcRenderer.on` 的 listener 会累积。

---

## Spec

### Spec-1 [P0] `thread/status/changed` 映射为 `TurnStarted` 违反事件语义

**Spec:** `CONTEXT.md` — Execution State 只取 `IDLE/QUEUED/RUNNING/INTERRUPTED/FAILED/RECOVERING`；`TurnStarted` 语义是"Turn 开始执行"。  
**File:** `packages/agent-manager/src/codex-event-bridge.ts:80-100`  
`thread/status/changed` 和 `warning` 通知被映射为 `TurnStarted` 事件并携带 `taskState: { executionState: "RUNNING", attentionState: "NONE" }`。这意味着一个 `thread/status/changed` 通知会把 task 状态强制设为 RUNNING，即使实际 Turn 没有在执行。  
**Impact:** 如果 Codex 发送 `thread/status/changed` 在 Turn 完成后（如 idle 状态变化），会把已完成的 task 重新标记为 RUNNING。这违反了 ADR-0007 "分离执行状态" 和 ADR-0016 "事件是 Task 状态来源"的语义。  
**Fix:** `thread/status/changed` 和 `warning` 不应携带 `taskState`，且应使用独立事件类型而非 `TurnStarted`。

### Spec-2 [P1] `INPUT_RESOLVE` discard 路径的 `executionState` 判断逻辑

**Spec:** `CONTEXT.md` — Uncertain Input "必须由用户决定检查、重发或丢弃"；ADR-0007 "禁止静默重发"。  
**File:** `packages/agent-manager/src/service.ts:310-318`  
discard 时 `executionState` 设为 `INTERRUPTED`（如果同 task 还有其他 uncertain input）或 `IDLE`（如果没有）。但 `attentionState` 始终设为 `USER_INPUT`。  
**Issue:** 如果所有 uncertain input 都被 discard 且没有活动 Turn，task 应该回到 `IDLE/NONE` 而非 `IDLE/USER_INPUT`。`USER_INPUT` 意味着"需要用户介入"，但用户刚刚完成了介入（discard）。  
**Fix:** 当没有剩余 uncertain input 时，`attentionState` 应设为 `NONE`。

### Spec-3 [P1] Workflow `runTicket` 失败后不清理 worktree

**Spec:** ADR-0025 "中断 Child Task 只停止 Runtime 执行并保留 Partial Diff、日志和 Worktree，不自动回滚或删除"。  
**File:** `packages/workflow/src/index.ts:112`  
`runTicket` catch 块设 `ticket.status = 'failed'` 和 `ticket.error`，但不清理 worktree。这**符合** ADR-0025 的要求——保留现场供人工检查。  
**Verdict:** PASS。实现与 spec 一致。

### Spec-4 [P1] `sendInput` 的 ACK 竞态处理

**Spec:** ADR-0007 "如果输入已发出但无法确认结果，则标记为 Uncertain Input"；ADR-0016 "不静默重发输入"。  
**File:** `packages/agent-manager/src/service.ts:169-175`  
`sendInput` 先 `recordInput`（落盘 SENT），再 `startTurn`，然后检查 `getEvents` 中是否已有 `TurnCompleted`。如果 Codex 通知在 `startTurn` 返回前就到达（line 174），`completed` 检查会捕获它并 `confirmTurnInputs`。如果未完成，写入 `TurnStarted` 事件并设为 RUNNING。  
**Issue:** 如果 `startTurn` 抛出异常但 Codex 实际已收到输入并开始执行，catch 块会 `markInputUncertain` 并设为 `INTERRUPTED/UNCERTAIN`。但 Codex 端可能正在执行——用户看到 UNCERTAIN 后 discard 输入，但 Codex 仍在跑。  
**Judgement call:** 这是分布式系统不可避免的语义。`markInputUncertain` 的设计意图正是如此——"无法确认是否执行完成"由用户判断现场。符合 spec。

### Spec-5 [P1] `APPROVAL_DECIDE` 设为 `IDLE/NONE` 但 Turn 可能未完成

**Spec:** `CONTEXT.md` — Approval 是"用户对一个具体动作的授权"。  
**File:** `packages/agent-manager/src/service.ts:378-386`  
`APPROVAL_DECIDE` 写入 `ApprovalDecided` 事件并设状态为 `IDLE/NONE`。但 approval 只是 Turn 中的一个步骤，Turn 可能还有后续步骤。把状态设为 IDLE 意味着 UI 认为任务已空闲，但 Codex 可能还在继续执行。  
**Fix:** approval 决策后应保持 `RUNNING/NONE`（或 `RUNNING/APPROVAL`），等 `turn/completed` 通知再设为 `IDLE`。当前实现会在 approval 和 turn/completed 之间产生状态闪烁。

### Spec-6 [P2] `verify()` 在 workflow 中不设 taskState

**Spec:** Gate 3 "Preflight 能阻止失效测试结果"。  
**File:** `packages/workflow/src/index.ts:131-138`  
`verify` 用 `spawnSync` 运行验证命令并记录 `fingerprint`。`passed` 判断为 `result.status === 0 && before === fingerprint(candidate.worktree)`。  
**Verdict:** PASS。fingerprint 检查确保验证后 worktree 未被修改，preflight 的 `stale-verification` blocker 会检查 fingerprint 变化。

### Spec-7 [P2] Renderer 只通过 Preload API 操作恢复输入

**Spec:** ADR-0015 "Renderer 只通过白名单 Preload API 通信"；ADR-0016 "Renderer 和 Electron Main 不直接访问数据库"。  
**File:** `apps/desktop/preload/src/index.ts:70-72`, `apps/desktop/renderer/src/index.tsx:222-233`  
Renderer 的 uncertain input 操作（`resolveInput`、`loadRecovery`）全部通过 `window.workbench.resolveInput` 和 `window.workbench.loadRecovery` 调用，后者通过 `ipcRenderer.invoke` 走 Preload 白名单。Renderer 不直接访问 `db` 或 `storage`。  
**Verdict:** PASS。边界清晰，无泄漏。

### Spec-8 [P2] 未误把 Provider 缺失环境下的测试结果当成真实 Turn 通过

**Spec:** `release-gates.md` Gate 2 "失败结果必须保留，不能用'理论可运行'代替"。  
**File:** `.scratch/m2-implementation/validation-02.md:68` — "流式 Agent 消息（无 Provider 凭据 → status=failed）" 标记为 SKIPPED。  
**File:** `.scratch/m2-implementation/validation-m2-continuation.md` — Provider SSE 中断标为 BLOCKED/NOT RUN，活动 Turn 标为 NOT RUN。  
**File:** `release-evidence/failure-injection/m2-matrix.json` — Renderer/Main/Manager Kill 标为 SANDBOX-BLOCKED 而非 PASS。  
**Verdict:** PASS。所有文档和证据文件均正确区分了"无 Provider 凭据环境下的失败"与"真实 Turn 通过"。无虚报。

### Spec-9 [P2] `recovery-mode` 只读模式拒绝写入但 `request()` allowlist 不完整

**Spec:** `release-gates.md` Gate 2 "只读 Recovery Mode 实测通过"；ADR-0016 "失败时进入只读 Recovery Mode"。  
**File:** `packages/agent-manager/src/service.ts:91`  
`request()` 在 recovery mode 下只允许 `['project:list', 'task:list', 'task:get', 'recovery:load', 'diff:get']`。  
**Issue:** `diff:get` 在 recovery mode 下可用，但 `diff:get` 调用 `getDiff(task.worktreePath)`，如果 worktree 路径不存在（如磁盘损坏场景），会抛异常。这不是 spec 违规——recovery mode 允许读取，读取失败返回错误是正确行为。  
**Verdict:** PASS。

---

## Summary

| Axis | Findings | Worst |
|---|---|---|
| Standards | 8 (0 P0, 1 P1, 7 P2) | S-1: `updateTaskStates` 事务边界不明确 |
| Spec | 9 (1 P0, 3 P1, 5 P2) | Spec-1: `thread/status/changed` 错误映射为 `TurnStarted` 并携带 RUNNING 状态 |

### P0 — Must fix before release

- **Spec-1**: `codex-event-bridge.ts:80-100` — `thread/status/changed` 和 `warning` 通知映射为 `TurnStarted` 事件并携带 `taskState: { executionState: "RUNNING" }`，会在 Turn 完成后错误地把 task 重新标记为 RUNNING。应使用独立事件类型且不携带 taskState。

### P1 — Should fix

- **S-1**: `storage/index.ts` — `updateTaskStates` 应标记为 private 或明确事务边界。
- **Spec-2**: `service.ts:316` — discard 后无剩余 uncertain input 时 `attentionState` 应为 `NONE` 而非 `USER_INPUT`。
- **Spec-5**: `service.ts:386` — `APPROVAL_DECIDE` 后应保持 `RUNNING` 而非设为 `IDLE`，避免 approval 与 turn/completed 之间状态闪烁。
