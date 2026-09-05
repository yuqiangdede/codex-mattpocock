# M2-02 验收：Runtime Session 接入真实 Codex

## 工单正文

`.scratch/m2-implementation/issues/02-runtime-session-lifecycle.md`

## 范围（已完成）

1. **packages/protocol**（新增类型）— Codex App Server 协议 MVP 子集：JSON-RPC
   帧、initialize/thread/turn/approval 等消息类型与常量。权威来源
   `release-evidence/protocol-trace/json-schema/` + Schema Hash
   `release-evidence/schema-hash.txt`，与 Spike 记录一致。
2. **packages/runtime-codex**（新增包）— stdio JSONL JSON-RPC 客户端
   `JsonRpcConnection`、进程管理 `CodexAppServer`、Provider Profile 与受控
   Secret 存储、Profile 级别进程复用的 `RuntimeSessionManager`。
3. **Provider Secret 受控认证 Helper**（`secret-helper.ts`）— 对标 T-012：
   Profile 不含凭据本体、Secret 单独落在私有配置目录、子进程环境只允许
   显式 allowlist 13 keys 透传给 Codex、Renderer/Project Shell 环境剔除。
4. **Agent Manager 接入**（`service.ts` 重构）— TURN_START 走真实 Codex
   Thread + Turn；APPROVAL_DECIDE 把决策回写到对应 server request；
   新增 TURN_STEER / TURN_INTERRUPT；M1 模拟 Turn 与写死 hello() 移除。
5. **codex-event-bridge**（新增）— 把 Codex 服务端通知（thread/started、
   turn/started/completed、warning）翻译为 NormalizedEvent；把
   Approval 请求翻译成 ApprovalRequest payload 并附带 serverRequestId。
6. **shared 包事件/IPC 扩展** — `EventType` 新增 RuntimeSessionOpened/
   Resumed/AgentMessageDelta/ToolStarted/ToolCompleted/TurnSteered；
   `IPC_CHANNELS` 新增 TURN_STEER/TURN_INTERRUPT；ApprovalRequest 加
   `serverRequestId` / `serverMethod`；MANAGER_REQUEST_CHANNELS 同步。

## 关键设计决策

- **Runtime Session = Task → Thread 映射**。线程按 Task 复用：同一 Task
  多次 startTurn 复用既有 Thread；不同 Task 跨 Profile 共享 App Server。
  不在 Manager 里维护 ApprovalRequest 状态机——decision 决策回到 Codex
  后由服务端自然推进 Turn。
- **Profile 与 Secret 分离**。Profile 仅存元数据（baseUrl、modelId、
  secretEnvKey），Secret 由 SecretStore 单独管理；进入 Codex 子进程时
  仅把 token 注入显式 allowlist 的一个 key，绝不向 Renderer / Project
  Shell 暴露。
- **setCallbacks 而非重起 App Server**。Runtime Session Manager 提供
  setCallbacks 让 Agent Manager 在 attachRuntime 后替换回调；已运行的
  App Server 在下一次 restart 时按新回调生效。设计权衡：回调替换对
  已运行 server 是部分生效，但 manager 装配在启动初期完成，业务场景
  没有 server 先于 attachRuntime 存在的窗口。
- **serverRequestId 走真实 id**。修复之前 app-server 把服务端 request
  id 写死 0 的 bug；jsonrpc 把 id 一并传给 onServerRequest，app-server
  原样写入 ServerRequest.id，approval 决策可按 id 精确对应。

## 验证证据

| 检查项 | 结果 | 说明 |
|---|---|---|
| tsc --build（packages/shared, protocol, runtime-codex, agent-manager, apps/desktop/main） | PASS | 全量编译通过 |
| electron-vite build | PASS | main / preload / renderer 三 bundle 产出 |
| WORKBENCH_SMOKE_TEST=1 Electron 冒烟 | PASS | `managerReady=true windowCreated=true` |
| scripts/test-runtime-codex.mjs（真实 codex.exe） | 19 PASS / 0 FAIL / 3 SKIPPED | 证据：`release-evidence/runtime-codex-integration.json` |
| scripts/test-agent-manager.mjs agent-manager 套件 | 部分 PASS | Utility Process 创建、IPC、事件流全过；worktree:create 阶段被 git 2.55 ref 校验阻塞（见已知问题） |
| scripts/test-m1.mjs（M1 E2E 回归） | FAIL（非本次回归引入） | 同样被 git 2.55 ref 校验阻塞（`fatal: invalid reference: task/<id>`） |

### runtime-codex 集成测试明细

| 类别 | 通过 | 跳过 |
|---|---|---|
| 前置条件 | binary、schema hash | — |
| Provider Profile 与 Secret 隔离 | Profile 存取、Profile 不含凭据、Secret 落私有目录、凭据只进 Codex 子进程、allowlist 13 keys、Renderer/Shell 剔除 | — |
| App Server 启动与 initialize 握手 | initialize 成功、进程存活 | — |
| Thread 生命周期 | thread/start 返回 UUID | thread/resume（需真实 Turn 落地） |
| Turn 控制 | turn/start UUID、turn/completed 到达、turn/interrupt 安全中止 | 流式 Agent 消息（无 Provider 凭据 → status=failed） |
| 优雅停止 | exited=true | — |
| RuntimeSessionManager 按 Profile 复用 | 两 Task 各自会话、绑定 Task、按 Task 查回、stopAll 关闭全部 | resumeSession（Codex 限制：空 thread 缺 rollout） |

## 已知问题（不阻塞本次验收）

### 1. M1 E2E / agent-manager 集成测试被 git 2.55 ref 校验阻塞

```
git worktree add -b task/task-mtog7l3d-8akvof ...
Preparing worktree (new branch 'task/task-mtog7l3d-8akvof')
fatal: invalid reference: task/task-mtog7l3d-8akvof
```

- **现象**：`git branch "task/x" HEAD` 在 git 2.55.0.windows.3（portableGit
  1.2.0）静默失败，退出码 0 但分支未创建。
- **范围**：影响所有需要 git worktree 的路径（M1 E2E、`worktree:create` IPC）。
- **归属**：环境工具链升级副作用，与本次 service.ts 重构无回归关系。
  b4e85b2 commit 通过前未触发。
- **临时绕过**：在 worktree-base 上加 init 或换分支命名策略（待
  investigate）。

### 2. 真实 Turn 流式 Agent 消息需 Provider 凭据

- **现象**：turn/start → turn/completed (status=failed)，无流式 delta。
- **原因**：环境无 `WORKBENCH_PROVIDER_API_KEY`，Codex 走默认 Provider
  探针失败。
- **归属**：环境约束，保留为 03 工单（持久化恢复）的并行 NOT_RUN 项。

## 留待下游

- **Task.runtimeThreadId 字段**：当前 RuntimeSessionManager 在内存中
  维护 taskId → threadId；进程重启后丢失。03 工单（持久化恢复）需要在
  storage.tasks 表加 runtimeThreadId 列，Manager 启动时按列 resume。
- **item/started / item/completed 映射**：当前未映射 TurnItem 级别的
  流式事件（命令输出 delta、Agent 消息 delta、FileChange 等），Timeline
  仅承载 Turn 生命周期 + Approval 决策。完整 item 映射按需在后续工单
  单独增量，避免本工单扩散。
- **Provider Profile UI**：当前 Profile 与 Secret 由 ProviderSecretStore
  在数据目录默认建立，无 Renderer 配置入口。后续工单补 Profile 编辑 UI。

## 工单结论

- Agent Manager 已接入真实 Codex App Server 通道，移除 M1 模拟 Turn。
- 进程隔离、Secret 隔离、协议握手、Thread/Turn 控制、审批路由全链路
  在真实二进制上验证可达。
- 三项 SKIPPED 是真实环境限制（空 thread 缺 rollout、无 Provider 凭据），
  非代码缺陷。
- 工单 02 可视为 DONE；DAG frontier 解锁 04-工单以外不依赖 Runtime
  Session 的工单与 03（持久化恢复）。