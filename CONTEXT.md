# Coding Agent Workbench

面向高级开发者的本地桌面工作台，通过可恢复的任务和工程工作流，推动软件需求从澄清一直到实现与审查。

## Language

**Project**:
用户交由工作台处理的一个本地软件项目，是任务、项目知识和工作区策略的归属边界。
_Avoid_: Repository, Workspace

**Project Identity**:
Workbench 为一个 Project 分配的稳定标识，关联其规范路径和 Git Identity；目录移动后可以重新关联，不同 Clone 默认属于不同 Project。
_Avoid_: Absolute Path, Remote URL, Folder Name

**Project Scan**:
添加 Project 时执行的只读检查，用于发现 Git 状态、Project 指令、Skill 和验证入口，不创建配置、Artifact 或 Worktree。
_Avoid_: Project Initialization, Setup

**Task**:
用户希望 Agent 完成的一项可持续、可恢复的工作，是产品中的主要执行与状态单位。
_Avoid_: Chat, Conversation, Runtime Thread

**Requirement Delivery Task**:
从需求澄清推进到最终 Review 的 MVP Task 类型，实施始终发生在独立 Parent Integration Worktree 中。
_Avoid_: Quick Task, Chat, Workflow Stage

**Workflow**:
把一类工程目标推进至明确产物和完成条件的阶段序列；首个工作流覆盖需求澄清、Spec、Ticket、实现与审查。
_Avoid_: Mode, Prompt Preset, Wizard

**Workflow Definition**:
描述 Workflow Stage、输入输出、Skill、Tool Policy、预算和 Gate 的版本化定义；Task 创建后固定其版本与内容哈希。
_Avoid_: Workflow Run, Skill, Prompt

**Artifact**:
任务在工作流中产生、消费或审查的持久成果，例如 Spec、Ticket、代码修改和 Review 结论。
_Avoid_: Message, Attachment, Tool Result

**Spec**:
经过用户批准、用于约束实施范围的 Artifact，包含目标、非目标、用户场景、需求、验收标准、约束、风险和未决问题。
_Avoid_: Requirement, Plan, Ticket

**Ticket**:
从已批准 Spec 拆出的可执行工作单元，具有稳定 ID，并记录依赖、验收条件、验证方式、影响范围和 Triage Label；标题与文件名不是身份。
_Avoid_: Task, Workflow Stage, TODO

**Ticket Snapshot**:
Child Task 开始时固定的 Ticket 内容与哈希，是判断后续外部修改是否使执行依据过期的基准。
_Avoid_: Ticket, Latest Ticket

**Completion Evidence**:
证明 Task 满足 Spec 验收标准的可审查材料，包括实际验证结果及其与验收标准的对应关系。
_Avoid_: Agent Claim, Summary

**Review Finding**:
独立 Review Session 发现的可追踪问题，包含严重度以及对应的 Spec、Ticket、文件位置和证据，并可转化为修订 Ticket；未处理的 Critical 或 High Finding 默认阻止最终 Gate。
_Avoid_: Tool Error, Agent Message

**Context Manifest**:
一次 Runtime Session 明确可见的上下文清单，列出自动建议、固定包含、用户补充和用户排除的 Context 来源；实际生效且不可排除的内容标为 Locked。
_Avoid_: Prompt, Project Memory, File List

**Runtime Context**:
当前 Runtime Session 为完成正在执行的工作而使用、并由 Agent Runtime 负责压缩的短期上下文。
_Avoid_: Task Memory, Project Memory, Conversation

**Task Memory**:
只服务一个 Task 的持久信息，由 Artifact、状态、决策和执行记录组成，随 Task 恢复并在完成后冻结。
_Avoid_: Runtime Context, Project Memory

**Project Memory**:
适用于同一 Project 后续 Task 的长期知识，优先保存在可审查、可 Diff、可提交的 Project 文档中。
_Avoid_: Task Memory, User Preference

**Integration Candidate**:
Parent Task 的 Integration Branch 上汇总所有已选 Child Task 修改、等待最终验证与 Review 的候选结果。
_Avoid_: Main Branch, Worktree, Pull Request

**Skill**:
封装可复用工程工作流、参考资源和可选脚本的能力单元，具有明确来源、Scope 和内容哈希。
_Avoid_: Workflow, Prompt Preset, Tool

**Skill Snapshot**:
Task 开始时记录的 Skill 来源、版本和内容哈希，用于保证 Workflow 在执行期间不会静默改变。
_Avoid_: Skill Cache, Latest Skill

**Skill Bundle**:
Workbench 从上游不可变 Commit 安装、验证并保留许可证与文件清单的一组内置 Skill；更新后的 Bundle 只影响新 Task。
_Avoid_: Skill Registry, User Skill, Workflow

**Connector**:
通过 MCP 向 Agent Runtime 暴露外部数据或操作能力的集成，不等同于 Model Provider。
_Avoid_: Model Provider, Tool Approval

**Connector Grant**:
用户授权一个 Task 读取特定 Connector 数据的许可；对外部系统产生写入或发送副作用仍需逐次批准。
_Avoid_: Provider Grant, Project Full Access

**Agent Runtime**:
代表 Agent 执行任务并维持会话、工具与审批语义的运行能力；本产品首版唯一的 Agent Runtime 是 Codex。
_Avoid_: Model, Backend, Thread

**Model Provider**:
向 Agent Runtime 提供模型推理能力的服务，可以由第三方或用户自建，但不负责完整的 Agent 执行生命周期。
_Avoid_: Agent Runtime, Model, Backend

**Custom Model Platform**:
由用户管理、通过 OpenAI Responses API 兼容协议向 Agent Runtime 提供模型的 Model Provider。
_Avoid_: OpenAI API, Agent Runtime

**Provider Profile**:
一个可复用的 Model Provider 配置，由服务地址、凭据引用和模型标识组成。
_Avoid_: Runtime Configuration, Account

**Provider Secret**:
保存在 Workbench 私有配置目录、由受控认证 Helper 读取的 Model Provider 凭据，不属于任何目标 Project，也不向 Renderer 或 Agent Shell 暴露。
_Avoid_: Provider Profile, Project Environment

**Provider Grant**:
用户在创建 Task 时授予的许可，允许该 Task 把必要的源码、终端输出和 Artifact 发送给选定的 Model Provider。
_Avoid_: Project Full Access, Tool Approval

**Provider Probe**:
在 Provider Profile 可用于 Task 前执行的无副作用兼容性验证，确认指定模型具备 Responses、Streaming 和 Tool Calling 能力。
_Avoid_: Health Check, User Task

**Runtime Session**:
由某个 Agent Runtime 管理的连续执行上下文，与 Task 关联但不等同于 Task。
_Avoid_: Task, Chat

**Project Full Access**:
允许 Agent 在选定 Project 内执行文件和 Shell 操作而无需逐项批准的默认权限模式；工作区外访问、凭据访问和外部副作用仍需批准。
_Avoid_: Full Access, Unrestricted Access, Safe Mode

**Safe Mode**:
允许 Agent 自动读取普通 Project 文件，但写文件、执行 Shell 和访问额外网络都需要逐次批准的权限模式。
_Avoid_: Read-only Mode, Project Full Access

**Project Trust**:
一个 Project 可撤销的授权记录，使新 Task 默认继承 Project Full Access；它不包含 Provider Grant、Connector Grant 或敏感文件访问权。
_Avoid_: Provider Grant, Global Trust

**Approval**:
用户对一个具有明确命令、路径、域名或 Connector 操作摘要的具体动作授权，可以只允许一次或严格限定在当前 Task；环境变化使原摘要失效时必须重新请求。
_Avoid_: Workflow Gate, Project Trust

**Parallel Task**:
与同一 Project 中其他 Task 同时执行、因而必须使用隔离工作目录的 Task。
_Avoid_: Background Turn, Subagent

**Child Task**:
从一个 Task 派生、仅在工作需要并行执行或独立 Runtime Session 与工作目录时创建的 Task，完成后把 Artifact 汇入父 Task。
_Avoid_: Workflow Stage, Subagent, Runtime Session

**Workflow Gate**:
Workflow 继续推进前必须满足的显式条件，可以要求用户确认某个 Artifact 或决策。
_Avoid_: Tool Approval, Permission Prompt

**Queued Input**:
用户在 Turn 运行期间提交、已持久化但尚未交给 Agent Runtime 的后续输入。
_Avoid_: Steer, Draft

**Steer**:
用户明确要求立即注入当前 Turn、用于调整正在进行工作的输入。
_Avoid_: Queued Input, New Turn

**Review**:
Task 完成前由用户检查 Artifact 和代码修改、逐项接受或提出修订的状态；Review 尚未通过的 Task 不属于 Completed。
_Avoid_: Tool Approval, Automated Test

**Task Lifecycle**:
Task 在产品中的长期阶段，只取 `OPEN`、`COMPLETED` 或 `ARCHIVED`，不表达当前是否正在执行。
_Avoid_: Execution State, Attention State

**Execution State**:
Task 当前的执行活动，只取 `IDLE`、`QUEUED`、`RUNNING`、`INTERRUPTED`、`FAILED` 或 `RECOVERING`。
_Avoid_: Task Lifecycle, Attention State

**Attention State**:
Task 当前是否需要用户介入，只取 `NONE`、`USER_INPUT`、`APPROVAL`、`REVIEW`、`STALE` 或 `UNCERTAIN`。
_Avoid_: Task Lifecycle, Execution State

**Uncertain Input**:
已经发往 Agent Runtime、但因连接或进程故障无法确认是否执行完成的用户输入，必须由用户决定检查、重发或丢弃。
_Avoid_: Queued Input, Failed Turn

**Attention Inbox**:
汇总所有 Task 中需要用户处理的输入、审批、Review、过期依据和不确定执行状态的全局入口。
_Avoid_: Notification Center, Task List
