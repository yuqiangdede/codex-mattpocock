# Coding Agent Workbench Release Gates

本文定义从协议 Spike 到 Windows Alpha Release 的验证 Gate。当前仓库仍处于设计阶段，以下均为必须实现的验收标准，不代表已经通过测试。

## 验证原则

- 每个 Gate 必须保存实际命令、退出码、关键输出和 Artifact 路径。
- Listener、窗口可见或构建成功都不等于核心流程成功。
- 自动化优先；需要人工点击时使用可重复的 HITL 检查表并保存证据。
- 失败结果必须保留，不能用“理论可运行”代替。
- 开发态、Unpacked、NSIS Installed 和 Portable 是不同环境，必须分别验证。

## 标准脚本契约

实施阶段必须提供 PowerShell 7、UTF-8 脚本：

```text
scripts/init.ps1    # 项目内依赖、Runtime 清单与开发环境初始化
scripts/start.ps1   # 开发启动
scripts/verify.ps1  # 分层验证，可选择 Gate
```

脚本不得默认依赖全局 Node、Python、Java Jar 或隐藏路径；超过 100MB 的开发下载遵循 `D:\cache` 复用规则，但发布后的产品运行不得依赖该缓存。

## Gate 0：协议与 Provider Spike

通过条件：

- 固定 Codex Binary 启动 App Server 并完成 initialize handshake。
- 生成并保存同版本 TypeScript Types 与 JSON Schema。
- Provider Probe 对指定 `base_url + model_id` 完成 Responses Streaming 和无副作用 Tool Calling。
- 创建、恢复、Fork、Steer、Interrupt、Compact 和读取 Thread 的协议测试通过。
- Command/File/Network/MCP Approval 请求可以暂停并正确响应。
- 两个 Reviewer Subagent 的事件、取消和完成可以观测。
- App Server 断流后不会自动重发最后一次输入。

证据：协议 Trace（脱敏）、Schema Hash、Provider Probe Report、失败用例输出。

## Gate 1：单 Task 纵向切片

通过条件：

- 添加 Git Project 并完成只读 Project Scan。
- 创建 Requirement Delivery Task、Integration Worktree 和 Runtime Session。
- Timeline 显示流式消息、Tool Event、Approval 和 File Change。
- Project Full Access 只自动允许 Project Scope 行为。
- 关闭 Renderer 并重载后 Task 继续运行。
- 明确退出时活动 Turn 安全中断，重开后恢复。
- 能生成一个真实代码修改、执行验证并显示 Diff。

证据：录屏或截图、Event Trace、Git Diff、验证输出和恢复前后 Task ID。

## Gate 2：持久化与恢复

通过条件：

- `node:sqlite` 在 Packaged Electron Utility Process 中完成 WAL、事务回滚、外键和并发读取测试。
- Event、Projection 和 Attention Outbox 同事务提交。
- 重复 Event 不产生重复 Timeline、Approval 或状态迁移。
- 大型 Tool Output 不写入 SQLite BLOB，Renderer 只加载受限 Tail。
- Online Backup、Migration Checksum、升级失败和只读 Recovery Mode 实测通过。
- 杀死 Agent Manager、App Server 和 Electron Main 后，非终态 Task 可以协调恢复。
- 已发出但未确认的输入成为 Uncertain Input，不自动重放。

证据：数据库 Check、Migration/Backup Report、故障注入日志和恢复状态快照。

## Gate 3：Requirement Delivery Workflow

通过条件：

- Requirement Grill 完成后由用户确认共享理解。
- Spec 包含必需结构，Gate 绑定哈希；外部修改会撤销批准。
- Ticket 使用稳定 ID，DAG 环检测有效，Triage Label 符合规则。
- Child Task 按依赖调度，并在独立 Worktree Commit。
- Child 失败只阻塞依赖后继，不影响无关 Ticket。
- Integration Candidate 汇总已选修改并生成 Completion Evidence。
- Final Review 使用独立 Session 和两个 Reviewer Subagent。
- Critical/High Finding 阻止 Gate，忽略时保存用户理由。
- Preflight 能阻止 Dirty Target、过期 Candidate、变化后的 Spec 和失效测试结果。
- 用户可以选择 Merge、Cherry-pick 或 Patch，系统不会自动 Push。

证据：Spec/Ticket/Review Artifact、DAG、Commit Graph、Completion Evidence、Preflight Report。

## Gate 4：Skills、Context 与 MCP

通过条件：

- 标准 `.agents/skills`、显式 External Root 和兼容来源均正确显示 Scope、路径和 Hash。
- 同名 Skill 不覆盖；未明确选择时阻止歧义调用。
- Project/User Skill 初次与内容变化后重新请求信任。
- 内置 11-Skill Bundle 保留 Commit、SHA256、MIT License 和 Third-Party Notice。
- 启动时后台检查上游 `main`；离线不阻塞；敏感变化要求人工 Gate；旧 Task 不切换 Snapshot。
- `diagnosing-bugs` 只显式调用，Windows HITL 使用标明来源的 PowerShell 补充。
- Context Manifest 显示 Locked/Suggested/Pinned/Added/Excluded，文件变化产生 STALE。
- Locked Context 超限会停止，不静默截断。
- Codex Compaction 事件和手动入口工作，Workbench 不自行压缩历史。
- MCP Connector 的读取 Grant 和写操作 Approval 分离。

证据：Skill Manifest、License Notice、Context Manifest 快照、MCP Approval Trace。

## Gate 5：Windows 发布与加固

通过条件：

- 生成并签名 Windows x64 NSIS Installer 和 Portable EXE。
- Installed 数据位于 `%LOCALAPPDATA%/<product>`；Portable 数据位于 EXE 同级 `data/`。
- 两种模式的数据目录、Single Instance 和更新流程不互相污染。
- NSIS 更新签名验证、活动 Task 延迟安装、版本切换和失败回滚通过。
- Portable 能检查并下载新签名 EXE，但不静默覆盖运行文件。
- Codex Runtime 官方地址、镜像、离线包、断点续传、SHA256、原子切换和回滚通过。
- Electron Fuses、ASAR Integrity、CSP、Preload 和 IPC 安全测试通过。
- 卸载不会删除用户 Project Artifact；删除 Task 必须显示精确 Cascade。

证据：签名验证输出、安装/卸载记录、更新与回滚报告、Packaged Smoke Report。

## 固定 Fixture 矩阵

| Fixture | 必须证明 |
|---|---|
| TypeScript/npm | 包安装、Lint/Test、文本与二进制 Diff、长日志 |
| Java/Maven | JDK/Maven 发现、Wrapper 优先、测试失败与恢复 |
| Python/pyproject | 项目 `.venv`、依赖清单、测试和相对路径 |

产品保持语言无关；Fixture 是已验证范围，不是硬编码语言 Adapter。

每个 Alpha Release 还必须用 Workbench 为自身仓库完成一个真实、有限的小功能，并保存从 Requirement 到 Integration 的全套 Artifact。

## Windows 路径矩阵

至少覆盖：

```text
C:\dev\plain-project
C:\用户\张三\项目 测试
C:\dev\a&b
D:\项目(新)
长路径超过传统 MAX_PATH 的 Project
只读 Project / 只读 Portable 数据目录
UNC 或网络共享数据目录（必须拒绝 SQLite WAL 启动）
```

每个路径至少验证 Project Scan、Worktree、Shell 参数、Artifact Rename、Diff、备份和清理预览。

## 故障注入矩阵

| 故障 | 期望结果 |
|---|---|
| Renderer Kill | Task 继续，重载后恢复 Projection |
| Electron Main Kill | Agent Manager 中断活动 Turn、落盘并退出 |
| Agent Manager Kill | 重启后协调 DB、Runtime 和 Git 现场 |
| App Server Kill | 仅影响对应 Provider Profile；不重发不确定输入 |
| Provider SSE 中断 | Stage Budget 内恢复或进入 USER_INPUT |
| 重复 Runtime Event | 幂等去重 |
| SQLite Migration 失败 | 回滚并进入只读 Recovery Mode |
| Event 与 Artifact 不一致 | 显式协调或 UNCERTAIN |
| Ticket/Spec 外部修改 | Gate 失效或 Child Task STALE |
| Target Branch 前进/Dirty | Preflight 阻止集成 |
| Skill 更新失败/离线 | 使用最后验证 Bundle，不阻塞启动 |

## Security Gate

必须包含自动化负向测试：

- XSS、Markdown HTML、ANSI Escape、恶意图片元数据。
- Preload 通用 Channel 暴露、伪造 IPC Sender、Schema 绕过。
- `..`、Symlink、Junction、短路径、大小写与 TOCTOU 路径逃逸。
- `.env`、私钥和 Token 进入 Context、Shell Env、日志或 Diagnostic Bundle。
- Approval 对象变化后复用旧批准。
- MCP 写操作伪装成读取。
- Skill 同名覆盖、Hash 变化、许可证变化和新增脚本。
- App/Runtime 更新元数据、Binary 或 Mirror 被篡改。
- Delete/Worktree Cleanup 使用宽泛路径。

## 性能与容量预算

参考 Windows x64 SSD 机器：

- 窗口 3 秒内可见。
- 50 个 Project、1000 个 Task 时，侧栏 5 秒内可操作。
- Event 接收后 UI 更新 p95 小于 100ms，不含 Provider 或用户命令耗时。
- 10k Timeline Item 可以虚拟化流畅滚动。
- 单个长 Task 支持 100k Event，不全量装入 Renderer。
- 单次 50MB Tool Output 不写入 SQLite、不冻结 UI。
- 单个 1000 文件 Diff 使用虚拟列表和单 Monaco 实例。

基线不满足时 Gate 失败；不得用提高测试机器配置掩盖无界内存增长。

## 可访问性与国际化

- Alpha 默认中文，所有文案来自 i18n 资源。
- Beta 前提供英语资源。
- 键盘可完成 Project/Task 切换、Composer、Approval、Review 和 Diff 导航。
- 焦点可见、语义标签正确、基础文本与控件达到 WCAG AA 对比度。

## Release Evidence

每个发布候选必须生成本地证据目录，至少包含：

```text
release-evidence/
  build-manifest.json
  dependency-versions.json
  signatures/
  runtime-manifest.json
  skill-manifest.json
  test-results/
  packaged-smoke/
  failure-injection/
  security/
  performance/
  known-risks.md
```

证据中不得包含 Secret。发布结论必须分别列出已通过项、未验证项和被接受的残余风险。
