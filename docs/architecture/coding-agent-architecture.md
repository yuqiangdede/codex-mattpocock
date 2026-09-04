# Coding Agent Workbench 架构

本文定义 MVP 的系统边界、进程模型、数据所有权和依赖方向。领域词汇以 [`CONTEXT.md`](../../CONTEXT.md) 为准；具体产品流程见 [`requirement-delivery-workflow.md`](../product/requirement-delivery-workflow.md)，安全边界见 [`threat-model.md`](../security/threat-model.md)。

## 架构目标

- 面向高级开发者提供 Windows x64、本地优先的 Requirement Delivery Workbench。
- 使用 Codex App Server 承担 Agent loop、Runtime Session、Tool、MCP、Skill 和 Compaction。
- 把 Task、Workflow、Artifact、Context、权限、Git Worktree 和恢复建模为产品能力。
- Renderer 崩溃不能终止后台 Task；状态不确定时停止并请求用户判断，绝不静默重放。
- 所有发布依赖、Runtime、数据和缓存都有明确、可迁移的数据根，不依赖开发机全局环境。

## 系统上下文

```text
User
  │
  ▼
Electron Renderer
  │ typed Preload API
  ▼
Electron Main
  │ versioned MessagePort Envelope
  ▼
Agent Manager Utility Process
  ├─ SQLite / content store / logs
  ├─ Git / Worktree / Artifact files
  └─ Codex App Server per Provider Profile
       │ JSONL over stdio
       ├─ Project Shell / FS / MCP / Skills
       └─ OpenAI Responses-compatible Model Provider
```

这里有两条不同的 IPC：Main 与 Agent Manager 使用 Electron `utilityProcess` 的 `parentPort`/`MessagePort`；Agent Manager 与 Codex App Server 使用 App Server 定义的 JSONL stdio。不得混用。

## 进程模型

### Renderer

- React + TypeScript。
- `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。
- 只持有可丢弃的 UI 状态和后端 Projection 快照。
- 不直接访问文件、Git、SQLite、Secret、Shell 或 App Server。
- Preload 只暴露逐项、强类型白名单 API；Main 校验 IPC Sender、参数 Schema 和 Project/Task Scope。

### Electron Main

- 管理窗口、托盘、原生文件选择、系统通知、Single Instance 和更新流程。
- 使用 `utilityProcess.fork()` 启动 Agent Manager。
- 监督心跳和退出；窗口关闭时继续驻留托盘，用户明确退出时要求 Agent Manager 安全中断活动 Turn 并落盘。
- 不实现 Workflow、Git 或数据库业务逻辑。

### Agent Manager

Agent Manager 是唯一应用写模型，负责：

- `ProjectManager`：Project Identity、只读 Project Scan、Relink。
- `TaskManager`：三维 Task 状态、Queue、Attention Inbox、恢复。
- `WorkflowEngine`：Workflow Definition、Stage、预算、Gate、Skill Snapshot。
- `ContextManager`：Context Manifest、哈希、Locked/STALE、内容存储。
- `ArtifactManager`：Spec、Ticket、Review Finding、Completion Evidence。
- `GitWorktreeManager`：Parent Integration Worktree、Child Worktree、Preflight、集成。
- `PermissionManager`：Safe Mode、Project Trust、Provider/Connector Grant、Approval。
- `RuntimeSupervisor`：Codex Bundle、App Server 生命周期和 Runtime Session 映射。
- `EventStore`：Normalized Event、Projection、Attention Outbox、内容引用。

Main 连接丢失后，Agent Manager 不作为不可见孤儿进程无限运行：它中断活动 Turn、持久化已知状态并退出。应用重开后执行恢复协调。

### Codex App Server

- 每个启用的 Provider Profile 对应一个 App Server 进程，该 Profile 下多个 Task 共享进程。
- Task 固定 Provider Profile、model ID 和 Runtime Session；运行中不静默换 Provider 或模型。
- App Server 崩溃后由 Agent Manager 重启并恢复 Thread；无法确认的 Turn 进入 `RECOVERING + UNCERTAIN`。
- App Server 当前属于需要版本锁定和兼容验证的集成接口，产品不能假设跨版本协议稳定。

## Runtime 与 Model Provider

MVP 只有 Codex Agent Runtime。Custom Model Platform 是 Model Provider，不是第二个 Runtime。

Provider Profile 只包含：

- `base_url`
- Provider Secret 引用
- `model_id`
- 最近一次 Provider Probe 结果

Provider 必须通过无副作用探针证明兼容 OpenAI Responses API、SSE Streaming 和 Tool Calling。探针以 `Provider Profile + model ID` 为粒度；地址、凭据或模型变化后失效。

Provider Secret 存在 Workbench 私有配置目录 `.env`，不进入目标 Project。Codex 通过受控 command-backed authentication Helper 取得 Token；Secret 不进入 Renderer、Project Shell 或普通 App Server 子进程环境。Portable 导出和备份默认排除该文件。

## 内部协议

Main 与 Agent Manager 的 Envelope 至少包含：

```ts
type Envelope<T> = {
  protocolVersion: number;
  messageId: string;
  requestId?: string;
  sentAt: string;
  kind: string;
  payload: T;
};
```

要求：

- 请求和响应可关联。
- 接收方按 `messageId` 去重。
- 需要持久化的命令先进入 Agent Manager Event Store，再确认接收。
- 未确认不等于未执行；重连后必须查询状态，不能盲目重发。
- stdout/stderr 只承载日志，不承载业务协议。

## 状态与持久化

### 数据所有权

| 数据 | 真相源 |
|---|---|
| Spec、Ticket、ADR、Review 结论 | Project 内 Markdown |
| Runtime Conversation | Codex Rollout / Thread |
| Task 状态、调度、映射、Projection | Workbench SQLite |
| Provider Secret | Workbench 私有 `.env` |
| 图片和大型 Tool Output | Workbench Content Store |
| Skill 内容 | 不可变 Skill Bundle / 显式外部 Root |

SQLite 不复制完整 Artifact 或 Codex Conversation。Ticket Frontmatter 保存意图、稳定 ID、依赖、验收、验证和 Triage Label；SQLite 保存执行和 Runtime 状态。

### SQLite

- Agent Manager 独占 `node:sqlite DatabaseSync` 写连接，不引入 ORM。
- 初始化验证 `journal_mode=WAL`、`synchronous=FULL`、`foreign_keys=ON`、Busy Timeout 和 `trusted_schema=OFF`。
- Event、Projection 和 Attention Outbox 在同一短事务中提交。
- 网络、Git、文件复制和模型调用不得发生在数据库事务内。
- 顺序 SQL Migration 使用版本、Checksum 和 Applied Timestamp。
- Migration 前执行一致性检查和 Online Backup；失败进入只读 Recovery Mode。
- Portable 数据根位于本地可写磁盘；UNC/网络共享禁止承载 WAL 数据库。

### Event 与 Projection

Normalized Event 使用至少一次处理语义和稳定去重键，Projection 更新必须幂等。大输出只在 Event 中保存摘要、大小和内容引用；原始 Runtime Event 仅用于脱敏、截断后的诊断。

Task 状态分成三个正交维度：

```text
Lifecycle: OPEN | COMPLETED | ARCHIVED
Execution: IDLE | QUEUED | RUNNING | INTERRUPTED | FAILED | RECOVERING
Attention: NONE | USER_INPUT | APPROVAL | REVIEW | STALE | UNCERTAIN
```

启动时，对所有非终态 Task 同时核对 Event Store、Codex Thread、Artifact 哈希和 Git/Worktree 现场，然后追加 Recovery Event。

## Artifact 与文件一致性

- 默认布局：根 `CONTEXT.md`、`docs/adr/`、`docs/specs/`、`.scratch/<feature-short-id>/`。
- Project 自身 `AGENTS.md` 或配置可覆盖默认布局。
- Artifact 采用临时文件、Flush 和同目录原子 Rename，再提交引用内容哈希的 Event。
- 文件已落盘但 Event 缺失，或 Event 指向的哈希不存在时，恢复流程必须显式协调。
- 外部编辑由 File Watcher 检测；批准后的 Spec 或已启动 Ticket 内容变化会撤销 Gate 或标记 STALE。

## Git 与 Worktree

- 每个 Requirement Delivery Task 都有独立 Parent Integration Branch 和 Worktree。
- Child Task 按 Ticket DAG 从满足依赖的确定 Commit 创建 Worktree。
- 不自动复制 Dirty Working Tree、不自动 Stash、不覆盖用户未提交修改。
- Agent 可以在 Child Branch Commit，但不能自动 Merge 到目标分支或 Push。
- Child 结果先进入 Parent Integration Branch，形成 Integration Candidate。
- 用户逐文件接受只形成 Review 选择；最终确认后才一次性 Merge、Cherry-pick 或导出 Patch。
- Preflight 重新验证目标分支、Dirty 状态、Candidate Commit、Spec 哈希和必需测试，任何变化都重新 Review。

## Context、Memory、Skill 与 MCP

- Runtime Context 由 Codex 管理并压缩；Workbench 只显示占用、事件和手动入口。
- Task Memory 是 Artifact、状态、决策和执行记录；Task 完成后冻结。
- Project Memory 优先保存为可审查 Markdown；修改长期规则前必须 Review。
- MVP 不实现 User Memory 或向量库。
- Context Manifest 显示 Locked、自动建议、用户固定、补充和排除项；文件按路径与哈希复核。
- Skill 规范来源是仓库层级及用户级 `.agents/skills`；外部 Root 和兼容目录必须标明来源。
- Skill Registry 由后台索引、File Watcher 和 Cache 更新，不在发送路径同步扫描。
- MCP 只透传 Codex 已配置 Connector 的状态、事件和 Approval，不建设市场。

## 构建、目录与发布

```text
apps/
  desktop/
    main/
    preload/
    renderer/
packages/
  protocol/
  agent-manager/
  storage/
  workflow/
  runtime-codex/
  git-worktree/
  shared/
skills/
  bundled/
runtime/
data/
cache/
logs/
scripts/
tests/
  fixtures/
  integration/
  e2e/
```

- pnpm Workspaces + TypeScript Project References。
- electron-vite 构建 Main/Preload/Renderer；electron-builder 生成 Signed NSIS 和 Signed Portable EXE。
- 安装版数据位于 `%LOCALAPPDATA%/<product>/`；Portable 数据位于 EXE 同级 `data/`。
- App 与 Codex Runtime 使用独立更新和完整性链。
- Runtime Bundle 首次下载，按版本并存、SHA256 校验、原子切换并保留上一版本。
- `node:sqlite` 在固定 Electron 版本的 Packaged Smoke Test 失败时，发布前整体切换到 `better-sqlite3`；不同时交付两套驱动。

## 强制依赖方向

```text
renderer
  → preload contract
  → electron main
  → application protocol
  → agent manager
  → runtime / storage / git adapters
  → Codex / SQLite / Git / filesystem
```

禁止 Renderer 横向直连 SQLite、Codex、Git、Shell、MCP 或 Secret。Workflow 只依赖产品级接口，不直接解析 App Server 原始事件。

## 依据与限制

- Codex App Server 适合富客户端深度集成，但进程拓扑是本项目根据隔离、Provider 配置和恢复目标作出的设计，不是 OpenAI 规定。[OpenAI App Server](https://developers.openai.com/codex/app-server/)
- Codex 自定义 Provider 当前以 Responses API 为 Wire Protocol。[Codex 配置参考](https://developers.openai.com/codex/config-reference/)
- `utilityProcess` 和 Renderer 隔离遵循 Electron 官方进程与安全模型。[Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)、[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- WorkBuddy 提供 Task-first 产品模型证据；独立 Agent Process 的工程经验主要来自 CodeBuddy IDE，不能表述成 WorkBuddy 已公开的完整内部实现。
