# Coding Agent Workbench 威胁模型

本文定义 MVP 的资产、信任边界、威胁、控制和残余风险。它不是泛化安全清单；每条控制都应在 [`release-gates.md`](../testing/release-gates.md) 中有验证证据。

## 安全目标

- 用户只因授权一个 Project 而承担该 Project 范围内的自动修改风险。
- Secret、工作区外数据和外部账号操作必须具有独立授权边界。
- Renderer、Project 文件、Skill、模型输出和 MCP 返回值都视为不可信输入。
- 破坏性或外部副作用操作必须显示精确对象，不能使用模糊的 `allowAll`。
- 崩溃、断线和重试不得导致命令、文件写入或外部调用静默重复执行。
- 更新、Runtime 和 Skill Bundle 都必须可验证、可回滚并保留来源。

## 受保护资产

- Project 源码、未提交修改、Git Branch、Commit 和 Worktree。
- Provider Secret、MCP 凭据、Git 凭据和系统凭据。
- Spec、Ticket、Review Finding、Completion Evidence 和用户决定。
- SQLite Task/Event 数据库、Codex Rollout、Content Store 和诊断日志。
- App、Codex Runtime 和 Skill Bundle 的完整性。
- 用户机器上的 Project 外文件、进程、网络和外部服务账号。

## 信任区域

```text
Untrusted Renderer Content
        │ validated Preload IPC
        ▼
Electron Main
        │ versioned MessagePort
        ▼
Agent Manager ── Workbench Data Root
        │
        ├─ Trusted Project boundary
        ├─ Codex App Server boundary
        ├─ Model Provider network boundary
        └─ MCP / external system boundary
```

Project Trust 不会向上扩张为机器信任；Provider Grant 与 Connector Grant 也互不继承。

## 权限模式

| 操作 | Safe Mode | Project Full Access |
|---|---|---|
| 读取普通 Project 文件 | 自动 | 自动 |
| 写入 Project | Approval | 自动 |
| 执行 Project Shell | Approval | 自动 |
| 读取敏感文件 | Approval | Approval |
| 已授权 Provider 请求 | Provider Grant 后自动 | Provider Grant 后自动 |
| 其他网络访问 | Approval | Approval |
| Connector 读取 | Connector Grant 后自动 | Connector Grant 后自动 |
| Connector 写入/发送 | 每次 Approval | 每次 Approval |
| Project 外路径 | 每次或严格 Task Scope Approval | 每次或严格 Task Scope Approval |
| Git Commit 到 Child Branch | Approval | 自动 |
| Merge/Cherry-pick 到目标分支 | Final Gate + Preflight | Final Gate + Preflight |
| Git Push、发布、系统配置 | 每次 Approval | 每次 Approval |

MVP 不提供机器级 Unrestricted 模式。

## 安全不变量

1. Renderer 永远不能直接访问 Node、SQLite、Shell、Git、Secret 或 App Server stdio。
2. Main 与 Agent Manager 的所有消息必须校验 Sender、Schema、协议版本和 Task/Project Scope。
3. Project 路径必须解析规范绝对路径，并在写入、移动、删除前重新检查真实目标仍位于授权 Root。
4. 符号链接、Junction、大小写、短路径和路径规范化不得绕过 Project 边界。
5. Provider Secret 不进入目标 Project、Renderer、日志、诊断包或 Agent Shell 环境。
6. Approval 必须绑定精确命令、路径、域名或 Connector 操作；对象变化后旧批准失效。
7. 用户主动 Terminal/Shell 与 Agent Shell 是不同能力；MVP 不提供内置非 Sandbox Terminal。
8. 未确认完成的输入不会自动重发。
9. 用户未提交修改不会被自动 Stash、覆盖、删除或移动。
10. 任何更新都先验证来源与完整性，再原子切换并保留可回滚版本。

## 主要威胁与控制

### Renderer 被利用

威胁：Markdown、Diff、ANSI、图片或 Tool Output 触发 XSS，随后调用高权限 IPC。

控制：严格 CSP、禁用 Node Integration、Context Isolation、Sandbox、白名单 Preload API、IPC Schema、Sender 校验、阻止任意导航和新窗口、校验 `openExternal` URL。HTML 默认不执行；ANSI 只解释允许的显示序列。

### 恶意或被提示注入的 Project

威胁：Project 指令、源码注释或测试输出诱导 Agent 读取 Secret、越界写入或外发数据。

控制：Project 指令在 Context Manifest 中标为 Locked 来源但仍低于系统安全边界；敏感文件和网络不因 Project Trust 自动开放；冲突进入 `needs-info`。Project Scan 只读，不执行仓库脚本。

### 路径穿越与链接逃逸

威胁：`..`、Junction、Symlink、特殊字符、UNC 或路径竞态把 Project 内操作导向外部。

控制：使用规范路径、真实路径和 Root 包含检查；破坏性操作前重新解析；禁止 SQLite WAL 数据位于 UNC；Windows 特殊路径进入强制测试矩阵。

### Shell 与命令注入

威胁：字符串拼接、PowerShell Quoting 或模型输出把一个批准命令变成其他命令。

控制：内部 API 使用可显示的可执行文件与参数数组；不使用 `Invoke-Expression`；Approval 展示解析后的程序、参数、CWD、环境增量和网络目标；日志对 Secret 脱敏。

### Provider 数据泄露

威胁：Task 把用户未预期的源码、图片、终端输出或 Secret 发给 Custom Model Platform。

控制：Task 创建时取得 Provider Grant；发送前展示 Context Manifest；敏感文件默认排除；Provider Profile 与 model ID 固定；地址变化使 Probe 和 Grant 失效。

### Provider Secret 泄露

威胁：明文 `.env` 被 Project、Renderer、Shell、备份、Portable 复制或诊断包读取。

控制：`.env` 位于 Workbench 私有数据 Root，设置最小文件 ACL；认证 Helper 单独读取并只输出 Token；App Server 和 Shell 使用清理后的环境；导出默认排除；Portable 模式显示复制警告。残余风险：具有同等本机用户权限的恶意进程仍可能读取明文文件。

### MCP 外部副作用

威胁：恶意 Tool Description 或模型判断导致发送消息、创建记录或泄露数据。

控制：Connector 读取使用 Task Scope Grant；写入、发送、创建和删除逐次 Approval；UI 显示 Connector、Tool、参数摘要和数据目的地；MVP 不提供 Connector 市场。

### 恶意 Skill 与供应链更新

威胁：Project/User Skill 或上游 `main` 更新引入脚本、外部依赖或恶意指令。

控制：显示 Scope、路径、Commit 和 SHA256；内置 Bundle 使用不可变 Commit 目录；同名 Skill 不覆盖；Project/User Skill 首次及内容变化后重新信任；许可证、新脚本或外部依赖变化要求人工 Gate；旧 Task 固定 Snapshot；离线继续使用最后验证版本。

### App 与 Codex Runtime 供应链

威胁：安装包、Portable EXE、更新元数据、下载镜像或 Runtime Bundle 被替换。

控制：App 使用稳定 Publisher Identity、时间戳和签名更新；Runtime Manifest 保存平台、架构、版本、完整 Bundle SHA256、官方地址和镜像；临时下载、校验、原子切换、保留上一版本。App 签名不能代替 Runtime 校验。

### Event 重复、缺失与重放

威胁：断线、恢复或崩溃让命令和外部 Tool Call重复执行，或让 UI 展示不存在的完成状态。

控制：至少一次事件处理、稳定去重键、幂等 Projection、Event/Projection/Outbox 同事务；启动恢复同时检查 Codex Thread、Git 和 Artifact。`UNCERTAIN` 必须由用户处置。

### Git 数据损坏

威胁：自动 Stash、Merge、Clean 或 Worktree 清理破坏用户修改。

控制：只从用户选择的 Commit/Branch 创建 Worktree；不自动 Stash；Agent Commit 仅限隔离 Branch；最终集成绑定 Candidate Commit 与 Preflight；Archive 不删除；Delete 展示精确 Cascade。

### 日志和诊断包泄露

威胁：请求、Header、环境变量、Tool Output 或 Diff 中包含 Secret。

控制：诊断日志只保留结构化、截断、脱敏事件；普通日志滚动保留 14 天；诊断包生成后先展示文件清单和脱敏预览，用户主动导出，不自动上传 Telemetry 或 Dump。

## Approval 生命周期

- Approval 创建时保存对象摘要、内容哈希、CWD、Task、Project 和时间。
- 本地文件/Shell Approval 可以持续等待。
- 外部系统或环境已变化时，执行前重新校验；失效后重新请求。
- 支持 `Allow Once`、`Reject`，以及严格限定的“本 Task 允许该域名/路径/Connector 读取”。
- 不提供隐式全局 Allow。

## 删除与恢复

- Archive 可恢复且不删除资产。
- Delete 分别列出 SQLite 记录、Runtime Session、Content Store、Worktree 和 Project Artifact。
- Worktree 清理前验证目标路径、Git 状态和是否还有唯一未集成 Commit。
- SQLite Migration 失败进入只读 Recovery Mode，不删除数据库。
- Online Backup 必须保持数据库与 WAL 一致，禁止直接复制正在使用的单个 `.db` 文件充当备份。

## 残余风险

- Codex App Server 和 `node:sqlite` 的成熟度变化需要持续版本验证。
- 自建 Provider 的“Responses-compatible”不代表模型具有可靠 Agent 行为；Provider Probe 只能验证协议底线。
- 本地同权限恶意软件可以攻击明文 Portable 数据和进程内存。
- 新 Publisher Certificate 不保证立即建立 SmartScreen 信誉。
- Agent 在 Project Full Access 下仍可能做出错误修改；Worktree、Review 和可恢复性降低损失，但不能保证代码正确。
