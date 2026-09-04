# Requirement Delivery Workflow

本文定义 MVP 唯一对外 Task 类型的用户流程、Stage、Artifact、Gate 和异常行为。领域术语见 [`CONTEXT.md`](../../CONTEXT.md)，技术实现见 [`coding-agent-architecture.md`](../architecture/coding-agent-architecture.md)。

## 用户目标

高级开发者提交一项软件需求后，Workbench 应把它推进为可审查的 Spec、可调度的 Ticket DAG、隔离实现、验证证据和最终 Integration Candidate。用户负责需求与风险决定，Agent 负责查事实、形成 Artifact、实施和提供证据。

## 创建 Task

创建页必须显示：

- Project 与只读 Project Scan 结果。
- 目标 Branch/Commit 和 Git Dirty 状态。
- Provider Profile、model ID 和 Provider Probe 状态。
- Safe Mode 或继承自 Project Trust 的 Project Full Access。
- Provider Grant 的数据外发说明。
- 初始需求文本以及文件、文件夹、图片、已有 Artifact 附件。
- 自动生成但可编辑的 Slug；持久路径附稳定短 Task ID。

非 Git Project 可以进入需求澄清和 Spec，但实施入口保持禁用，并说明用户需自行初始化 Git。

## 主流程

```text
Project Scan
  ↓
Setup Proposal（需要时）
  ↓
Requirement Grill + Domain Modeling
  ↓
Spec
  ↓
[Spec Gate]
  ↓
Ticket DAG
  ↓
Child Task Implementation + Ticket Review
  ↓
Parent Integration Candidate
  ↓
Verification
  ↓
Independent Final Review
  ↓
[Final Review Gate]
  ↓
Integration Preflight
  ↓
User-selected Integration
```

## Stage 定义

### 1. Project Scan

只读发现 Git Identity、当前分支、Dirty 状态、Project 指令、CONTEXT/ADR、Skill、构建入口和测试命令。扫描不生成文件、不初始化 Git、不安装依赖。

输出：Project Scan Report。

### 2. Setup Proposal

仅在 Project 缺少必要 Agent 约定时运行内置 `setup-matt-pocock-skills`。Skill 只生成 Patch；修改 `AGENTS.md`、Agent 文档或 Skill 配置前必须由用户 Review。

无修改需要时，本 Stage 标记为已检查并跳过。

### 3. Requirement Grill + Domain Modeling

`grill-with-docs` 编排 `grilling` 与 `domain-modeling`：按决策树逐轮解决产品决定，由 Agent 查询环境事实，并即时更新领域词汇和真正符合条件的 ADR。

完成条件：决策树 Frontier 为空，用户明确确认共享理解。

### 4. Spec

Spec 至少包含：

- 目标与非目标
- 用户场景
- 功能需求
- 验收标准
- 约束
- 风险
- 未决问题

未决问题不为空时不能进入 Spec Gate。

### 5. Spec Gate

用户批准时记录 Spec 内容哈希。任何内外部修改导致哈希变化时：

- Gate 自动失效。
- 尚未开始的实施暂停。
- 已运行 Child Task 标记 `Attention=STALE`，由用户决定继续、停止或完成后重新 Review。

### 6. Ticket DAG

每个 Ticket 是 `.scratch/<feature-short-id>/` 下的独立 Markdown 文件，并具有稳定 ID。Frontmatter 保存依赖、验收、验证、影响范围和 Triage Label；索引文件描述 DAG。

默认 Label：

- 完整且依赖明确：`ready-for-agent`
- 缺少决定：`needs-info`
- 等待人工 Review：`ready-for-human`
- 用户明确放弃：`wontfix`
- 无法判断下一责任人：`needs-triage`

DAG 必须无环。Spec 批准后自动生成并展示 Ticket；它不是额外 Gate，用户可以暂停或编辑尚未开始的 Ticket。

### 7. Child Task Implementation

调度器只启动所有依赖已经完成的 Ticket。Child Task 在独立 Worktree 和 Runtime Session 中运行 `implement` 与 `tdd`，启动时固定 Ticket Snapshot、Skill Snapshot、Provider、模型和基础 Commit。

`implement` 内部的 `code-review` 属于 Ticket 级 Review，允许在隔离 Branch Commit，但不能 Merge 到目标分支或 Push。

失败行为：

- Stage Budget 内可以重试。
- 预算耗尽后进入 `Execution=FAILED`、`Attention=USER_INPUT`。
- 无关 Ticket 可以继续；依赖失败 Ticket 的后继保持阻塞。
- 用户 Interrupt 时保留 Partial Diff、日志和 Worktree。

### 8. Parent Integration Candidate

已选择的 Child 结果先集成到 Parent Integration Branch，形成一个确定 Commit 的 Integration Candidate。每次 Candidate 变化都使旧 Verification 和 Final Review 失效。

### 9. Verification

实际运行 Project 定义的必要验证，并为每条 Spec 验收标准生成 Completion Evidence。退出码为 0 不是充分条件；证据必须能对应具体标准。

### 10. Independent Final Review

新的 Review Session 只接收：

- 已批准 Spec
- Ticket 与状态
- Integration Candidate Diff
- Verification 结果
- 实际生效的 Project 约定

它不继承实现 Session 的推理历史。`code-review` 使用两个 Reviewer Subagent；Runtime 不支持时进入 `needs-info`，不得静默降为单 Reviewer。

Review Finding 包含严重度、Spec/Ticket 引用、文件位置和证据：

- Critical/High 默认阻止 Final Review Gate。
- Medium/Low 是警告，可升级、忽略或转为修订 Ticket。
- 忽略阻塞 Finding 必须记录用户理由。
- Reviewer 不直接修改正在审查的 Candidate；修复进入新 Ticket 循环。

### 11. Final Review Gate

用户可以逐文件接受、拒绝或提出修订。逐项操作只记录 Review 选择，不立即写入目标工作区。

Task 可以 Completed 的最低条件：

- 所有必需验收标准具有 Completion Evidence。
- 必需验证通过。
- 没有未解决 Approval 或 Uncertain Input。
- Critical/High Finding 已解决或由用户明确接受风险。
- Final Review Gate 绑定当前 Candidate Commit 和 Spec 哈希。

### 12. Integration Preflight 与集成

Preflight 重新验证：

- 目标 Branch/Commit 与用户审查时一致。
- 目标 Working Tree 没有新 Dirty 状态。
- Candidate Commit 与 Review 绑定值一致。
- Spec 哈希未变化。
- 必需验证仍有效。

任一不一致都阻止自动集成并重新计算 Diff/冲突。通过后，用户明确选择 Merge、Cherry-pick 或导出 Patch。Workbench 不自动 Push。

## Context 行为

Context Manifest 分为：

- Locked：系统安全规则、生效 Project 指令、批准 Spec、当前 Ticket。
- Suggested：Agent 按 Stage 建议。
- Pinned：用户要求 Task 内持续包含。
- Added：用户本轮补充。
- Excluded：用户明确排除，后续 Stage 不得静默加入。

文件和目录保存路径及哈希，Turn 发送前复核；图片复制到 Task 内容存储并按哈希去重。Locked Context 超出窗口时阻止 Turn，列出大小和缩减建议，不截断 Spec 或 Project 指令。

## 输入、Queue 与 Steer

- Turn 运行期间的普通输入先作为 Queued Input 持久化，按 FIFO 等待。
- “立即调整当前执行”才调用 Steer，并在 Timeline 明确标记。
- 已发出但未确认的输入成为 Uncertain Input，由用户检查、重发或丢弃。
- Provider 或模型失败不会触发静默切换。

## Task 状态与调度

UI 同时显示 Lifecycle、Execution 和 Attention，而不是把它们压成一个枚举。默认全局 Running Turn 上限为 2，Provider Profile 上限为 2，并在不同 Project 间公平调度。

Task 列表默认顺序：需要 Attention、Running、Queued、最近活动；支持 Pin 和 Project 内手动排序。Attention Inbox 汇总 `USER_INPUT`、`APPROVAL`、`REVIEW`、`STALE` 和 `UNCERTAIN`。

## 主界面

```text
┌─────────────────┬────────────────────────────┬──────────────────────┐
│ Project / Task  │ Timeline / Composer        │ Context / Artifact   │
│ Attention Inbox │ Stage progress / Ticket DAG│ Diff / Approval      │
└─────────────────┴────────────────────────────┴──────────────────────┘
```

- 右侧面板可折叠。
- Timeline 展示 Reasoning Summary、步骤、Tool Event 和结果；详细输出默认折叠。
- 命令输出只实时展示有上限的 Tail，完整内容按需读取。
- Monaco Diff Editor 懒加载并复用单实例，不为每个文件创建 Editor。
- Spec/Ticket 支持内置 Markdown 编辑预览和外部编辑器。
- MVP 不包含内置交互式 Terminal，只提供“在外部 Terminal 打开”。

## Skill 行为

MVP 内置 11-Skill Bundle。`diagnosing-bugs` 可在 Composer 中由用户显式选择，但不自动触发、不改变顶层 Workflow；其 Windows HITL PowerShell 模板是 Workbench 自有补充。

每次启动在后台检查上游 `main`：普通更新通过验证后成为新 Task 默认版本；许可证、新脚本或外部依赖变化必须人工批准；旧 Task 保持原 Skill Snapshot，离线不阻塞启动。

## Archive 与 Delete

- Archive 只隐藏 Task，可恢复，不删除 Runtime Session、Artifact 或 Worktree。
- Archive 时提示是否清理已完成 Worktree。
- Delete 必须预览精确范围，并分别选择数据库记录、Runtime Session、Content Store、Worktree 和 Project Artifact。
- 中断、失败或拒绝 Review 不自动删除任何用户修改。
