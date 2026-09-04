# Coding Agent Workbench MVP Spec

状态：Accepted Design

本文是 MVP 的范围与验收契约。领域语言见 [`CONTEXT.md`](../../CONTEXT.md)；架构、流程、安全和测试细节分别见：

- [`coding-agent-architecture.md`](../architecture/coding-agent-architecture.md)
- [`requirement-delivery-workflow.md`](../product/requirement-delivery-workflow.md)
- [`threat-model.md`](../security/threat-model.md)
- [`release-gates.md`](../testing/release-gates.md)

## 摘要

构建一个面向高级开发者的 Windows x64 本地桌面 Workbench，把软件需求推进为已批准 Spec、Ticket DAG、隔离实现、验证证据、独立 Review 和用户选择的 Git 集成结果。

产品借鉴 WorkBuddy 的 Task-first 体验，但不声称复刻其未公开内部架构；Agent Harness 使用固定版本 Codex App Server，自建平台只作为 OpenAI Responses-compatible Model Provider。软件工程流程使用经过许可审计和版本控制的 Matt Pocock Engineering Skills。

## 目标用户

- 已经理解本地仓库、Git、命令行和代码审查的高级开发者。
- 愿意让 Agent 在明确 Project Scope 内修改代码，但要求任务可恢复、上下文可见、修改可审查。
- 使用 Windows 11 x64；Alpha 默认中文。

MVP 不以新手、企业管理员、移动用户或云协作团队为主要用户。

## 要解决的问题

现有 Coding Agent 往往把长期软件工作压成一段聊天历史，导致：

- 需求、实现和 Review 边界不清。
- 多项工作共享目录而相互覆盖。
- 上下文和数据外发不可见。
- 崩溃、断流和恢复可能重复执行。
- Agent 声称完成，但缺乏验收证据。
- Skill、Project 规则和模型配置在运行中漂移。

MVP 的核心差异化不是新的 Agent Loop，而是可验证的 Requirement Delivery Workflow。

## 目标

1. 把 Requirement 从澄清推进到可集成结果。
2. 用 Task、Artifact、Gate 和 Completion Evidence 替代无结构聊天。
3. 用 Integration Worktree 隔离所有实施修改。
4. 在进程或网络故障后恢复 Task，且不静默重复执行。
5. 向用户展示实际 Context、权限、Approval、Diff 和 Review Finding。
6. 支持自建 Responses-compatible Model Provider。
7. 提供可复制的 Installed 与 Portable Windows 发布物。

## 非目标

MVP 不包含：

- 第二种 Agent Runtime 或通用 Runtime 抽象。
- Quick Task、任意 Workflow Builder 或通用聊天模式。
- User Memory、向量数据库或跨 Project 自动记忆。
- 内置交互式 Terminal。
- Connector 市场或自建 MCP Host。
- 产品账号、云同步、团队协作或远程任务。
- macOS、Linux 或 Windows arm64 发布物。
- Portable 静默自动更新。
- VS Code Fork、自研 Agent Loop、Spring Boot 或 Python 常驻服务。
- 自动 Git Push、自动修改目标分支或自动初始化 Git。

## 核心用户场景

### 场景 A：新需求交付

用户添加一个 Git Project，选择 Provider、模型、目标 Commit 和权限模式，输入需求并附加相关文件。Workbench 澄清需求、生成 Spec、等待批准、拆成 Ticket DAG，在隔离 Worktree 中实施并验证，最后生成独立 Review 和可审查 Integration Candidate。用户通过 Preflight 后选择 Merge、Cherry-pick 或 Patch。

### 场景 B：应用重启恢复

任务运行时用户关闭窗口，应用进入托盘并继续。若用户明确退出或进程崩溃，Workbench 在重开后核对 SQLite、Codex Thread、Artifact 和 Git 现场；已知状态恢复，不确定输入要求用户处理，不自动重发。

### 场景 C：外部修改使依据过期

用户在外部编辑器修改已批准 Spec 或正在执行的 Ticket。Workbench 检测哈希变化，撤销 Gate 或标记 Child Task STALE，并让用户决定停止、继续旧 Snapshot 或完成后重新 Review。

### 场景 D：显式 Bug 诊断

用户在 Requirement Delivery Task 中显式选择 `diagnosing-bugs`。Workbench 使用其反馈闭环方法，但不自动把普通需求改成 Bug Workflow，也不新增顶层 Task 类型；需要 HITL 脚本时提供产品自有 PowerShell 模板。

## 功能需求

### FR-001 Project 管理

- 添加 Project 时只执行 Project Scan。
- Project 使用稳定内部 ID、规范路径和 Git Identity。
- 目录移动后支持 Relink；不同 Clone 默认是不同 Project。
- 识别 Project 指令、CONTEXT/ADR、Skill、构建和验证入口。

### FR-002 Provider Profile

- 用户配置 `base_url`、Provider Secret 和 `model_id`。
- Provider Secret 位于 Workbench 私有 `.env`，通过 authentication Helper 读取。
- 每个 Profile+Model 必须通过 Responses Streaming 与 Tool Calling Probe。
- Task 创建后固定 Profile 和模型；失败时不自动切换。

### FR-003 Runtime 管理

- 首次运行按 Manifest 下载固定 Codex Runtime Bundle。
- 校验完整 Bundle SHA256，支持官方地址、镜像、代理、断点续传和离线导入。
- 每个 Provider Profile 一个 App Server，多个 Task 共享。
- 新旧 Runtime 并存，新版本 Smoke Test 后原子切换，失败回滚。

### FR-004 Task 创建

- MVP 只创建 Requirement Delivery Task。
- 创建页显示 Project、目标 Git 状态、Provider/Model、Permission、Provider Grant 和附件。
- Task 使用可编辑 Slug 与稳定短 ID。
- 非 Git Project 可以生成 Spec，但不能实施。

### FR-005 Workflow 与 Gate

- Task 固定 Workflow Definition 和 Skill Snapshot。
- 执行完整 Requirement Delivery Stage 顺序。
- Spec Gate 与 Final Review Gate 是默认人工 Gate。
- Spec Gate 绑定内容哈希，变化后失效。
- Stage 具有 Token、时间和重复失败预算。

### FR-006 Spec 与 Ticket

- Spec 包含目标、非目标、场景、需求、验收、约束、风险和未决问题。
- Ticket 是独立 Markdown，具有稳定 ID、依赖、验收、验证、影响范围和 Triage Label。
- Ticket DAG 必须无环，调度器只运行依赖已完成的 Ticket。
- Markdown 管意图；SQLite 管执行状态。

### FR-007 Git 隔离

- 每个 Requirement Delivery Task 都创建 Parent Integration Branch/Worktree。
- Child Task 从确定 Commit 创建隔离 Worktree。
- 不复制 Dirty Working Tree，不自动 Stash，不覆盖未提交修改。
- Agent Commit 仅限隔离 Branch；禁止自动 Push。

### FR-008 Child Task 实施

- 每个需要隔离或并行的实施 Ticket拥有独立 Runtime Session。
- `implement`、`tdd` 和 Ticket 级 `code-review` 在 Child Worktree 中执行。
- 失败只阻塞依赖后继；中断保留 Partial Diff、日志和 Worktree。
- 已启动 Ticket 内容变化时标记 STALE，不热替换输入。

### FR-009 Verification 与 Review

- 验证结果必须映射到 Spec 验收标准。
- Final Review 使用独立 Session、两个 Reviewer Subagent，且不继承实现推理历史。
- Review Finding 包含严重度、Spec/Ticket、文件位置和证据。
- Critical/High 默认阻止 Gate；用户忽略时必须记录理由。

### FR-010 Integration

- Child 修改先进入 Parent Integration Candidate。
- 逐文件 Review 不立即修改目标工作区。
- Preflight 绑定目标分支、Dirty 状态、Candidate Commit、Spec 哈希和验证结果。
- 用户明确选择 Merge、Cherry-pick 或 Patch。

### FR-011 Context Manifest

- 显示 Locked、Suggested、Pinned、Added 和 Excluded Context。
- 文件/目录记录路径和哈希，Turn 发送前复核。
- 图片进入 Task Content Store，按哈希去重。
- Locked Context 超限时阻止执行，不静默截断。
- 用户排除项不能被后续 Stage 自动加入。

### FR-012 权限与 Approval

- 提供 Safe Mode 和默认 Project Full Access，不提供机器级 Unrestricted。
- Project Trust 可撤销并可被新 Task 继承。
- 敏感文件、Project 外路径和额外网络始终需要 Approval。
- Provider Grant、Connector Grant 和 Project Trust 分离。
- Approval 绑定精确对象，并支持 Allow Once、Reject 和严格 Task Scope Grant。

### FR-013 Queue 与 Attention

- Turn 运行时普通输入持久化为 Queued Input；显式操作才 Steer。
- 全局和 Provider Profile 并发上限默认均为 2，并在 Project 间公平调度。
- Attention Inbox 汇总 User Input、Approval、Review、STALE 和 UNCERTAIN。
- 未确认执行结果的输入不自动重发。

### FR-014 状态与恢复

- 分别保存 Lifecycle、Execution 和 Attention State。
- Normalized Event 至少一次处理，Projection 幂等。
- Event、Projection 和 Attention Outbox 同事务提交。
- 启动恢复核对 SQLite、Codex Thread、Artifact 和 Git/Worktree。
- Migration 失败进入只读 Recovery Mode。

### FR-015 Skill

- 规范发现 `.agents/skills`；External Root 与兼容目录明确标注来源。
- 同名 Skill 不覆盖，歧义时要求选择。
- Project/User Skill 首次与内容变化后重新信任。
- 内置 11-Skill Bundle 保存 Commit、Hash、MIT License 和 Notice。
- 每次启动后台检查上游 `main`；敏感变化需要人工批准；离线不阻塞。
- `diagnosing-bugs` 只允许显式调用。

### FR-016 Memory 与 Compaction

- MVP 只有 Runtime Context、Task Memory 和 Project Memory。
- Project Memory 修改通过 Diff Review。
- Compaction 完全委托 Codex；Workbench 只显示和触发，不自行摘要历史。

### FR-017 MCP

- 展示 Codex 已配置 Connector 的发现、状态、调用 Event 和 Approval。
- 首个 Workflow 不依赖 MCP。
- Connector 读取使用 Task Scope Grant；写入和发送逐次批准。

### FR-018 UI

- 左侧 Project/Task 与 Attention Inbox。
- 中间 Timeline、Stage Progress、Ticket DAG 和 Composer。
- 右侧可折叠 Context、Artifact、Diff 和 Approval。
- Timeline 只展示 Reasoning Summary，不依赖隐藏推理。
- Monaco Diff Editor 懒加载、单实例复用，文件列表虚拟化。
- Spec/Ticket 可内置编辑预览或外部打开。

### FR-019 生命周期与删除

- 关闭窗口进入托盘；明确退出中断活动 Turn 并落盘。
- Archive 可恢复且不删除资产。
- Delete 展示数据库、Runtime Session、Content、Worktree 和 Project Artifact 的精确 Cascade。
- 归档时可以单独确认清理 Worktree。

### FR-020 发布与更新

- 发布 Signed NSIS Installer 和 Signed Portable EXE。
- Installed 数据位于 `%LOCALAPPDATA%`；Portable 数据位于 EXE 同级 `data/`。
- NSIS 支持签名更新，活动 Task 期间不安装。
- Portable 只检查和下载新 EXE，不静默替换。
- App、Runtime 和 Skill 使用三条独立版本与完整性链。

## 技术约束

- Electron + React + TypeScript。
- electron-vite + electron-builder。
- pnpm Workspaces + TypeScript Project References。
- Electron `utilityProcess` + versioned MessagePort Envelope。
- 独立 Agent Manager，独占 `node:sqlite DatabaseSync`。
- 参数化 SQL、自有顺序 Migration，不使用 ORM。
- TanStack Query + Event Reducer + Zustand UI State。
- Monaco Diff Editor；MVP 无 xterm.js。
- Codex App Server 与 Agent Manager 使用 JSONL stdio。

## 非功能需求

### 可靠性

- Renderer、Main、Agent Manager、App Server 分别故障时行为可预测。
- 未知状态优先进入 UNCERTAIN，不进行可能重复的恢复动作。
- Artifact、Event 和 Git 现场可协调恢复。

### 性能

- 窗口 3 秒内可见。
- 1000 Task 侧栏 5 秒内可操作。
- Event 到 UI 的 p95 更新延迟小于 100ms。
- 10k Timeline Item、100k Event、50MB Tool Output 和 1000 文件 Diff 不造成全量 Renderer 装载。

### 安全与隐私

- Renderer 无高权限能力。
- Secret 不进入 Project、Shell、日志和 Diagnostic Bundle。
- 不自动上传 Telemetry 或 Crash Dump。
- 用户导出诊断包前可以查看内容和脱敏结果。

### 可移植性

- Alpha 支持 Windows 11 x64。
- 路径支持中文、空格、`&`、括号、长路径和非 C 盘。
- Portable 数据、Runtime、Cache、Log 和 Backup 均位于自身数据 Root。

### 可访问性与本地化

- Alpha 默认中文且文案全部资源化。
- Beta 前补英语。
- 核心流程支持键盘、可见焦点和基础 WCAG AA 对比度。

## MVP 总体验收

MVP 只有在以下真实路径全部通过时完成：

1. 配置并 Probe 一个自建 Responses-compatible Provider。
2. 添加包含特殊字符路径的 Git Project。
3. 创建 Requirement Delivery Task 并批准 Spec。
4. 生成有依赖的 Ticket DAG，并运行至少两个 Child Task。
5. 实际执行测试、形成 Integration Candidate 和 Completion Evidence。
6. 两个 Reviewer Subagent 完成独立 Final Review。
7. 用户处理 Finding，通过 Final Gate 和 Preflight，并选择一种集成方式。
8. 在流程中分别注入 Renderer、Agent Manager、App Server 和 Provider 故障，证明恢复与 UNCERTAIN 行为。
9. 关闭并重开应用后继续同一 Task。
10. NSIS Installed 和 Portable 制品均重复完成关键路径。

完整矩阵以 [`release-gates.md`](../testing/release-gates.md) 为准。

## 实施里程碑

```text
M0 Protocol / Provider Spike
M1 Single Task Vertical Slice
M2 Persistence and Recovery
M3 Requirement Delivery Workflow
M4 Skills, Context and MCP
M5 Windows Packaging and Hardening
```

不设置未经资源验证的日历日期。每个里程碑通过对应 Release Gate 后才能开始下一阶段；不能以 UI Demo 或成功构建代替 Gate。

## 主要风险

| 风险 | 当前处理 |
|---|---|
| Codex App Server 协议变化 | 固定 Binary/Schema、版本测试、回滚 |
| 自建 Provider 表面兼容但 Agent 能力不足 | 每模型 Probe、真实 Workflow Smoke Test |
| `node:sqlite` RC | 薄 Storage Adapter、Packaged Gate、发布前整体回退方案 |
| Skill `main` 供应链变化 | 不可变 Commit、Hash、许可证/脚本变化 Gate |
| Worktree/目标分支冲突 | 隔离 Branch、Preflight、禁止自动 Stash/Push |
| 事件恢复重复副作用 | 去重、幂等 Projection、UNCERTAIN 人工处置 |
| Portable 明文 Provider Secret | 私有目录、ACL、导出排除、复制警告；残余本机风险明确披露 |
| Electron Renderer 攻击面 | Sandbox、CSP、白名单 Preload、IPC/路径负向测试 |

## 未决问题

当前设计讨论没有未决产品或架构分支。实现中若需要改变本 Spec 的边界，必须先更新 `CONTEXT.md` 或新增/修订 ADR，再修改 Spec 和 Release Gate。
