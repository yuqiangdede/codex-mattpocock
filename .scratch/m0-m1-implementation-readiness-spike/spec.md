---
title: M0–M1 Implementation Readiness Spike
labels:
  - ready-for-agent
---

## Problem Statement

Coding Agent Workbench 的 MVP 设计已经通过 Accepted Design 阶段（`docs/specs/coding-agent-workbench-mvp.md`），但仓库仍处于纯设计状态：没有 Electron 工程、没有 Node/Electron 版本锁、没有打包配置、没有 Provider Helper、没有私有 ACL、没有 Windows 制品。

在开始 M0 Protocol/Provider Spike 和 M1 Single Task Vertical Slice 的产品实施之前，开发者面对三个阻塞性不确定性：

1. **Codex App Server 协议边界未经验证**：虽然 `validate-codex-app-server-contract.md` 已确认了理论上稳定的 API 表面，但没有实际运行过固定 Binary 的 initialize handshake、Thread lifecycle、Turn control、Approval、Review 和 Skill/MCP 调用，也没有生成 Schema Hash 或脱敏 JSONL Trace。
2. **Windows Provider 与 Storage 基线未经验证**：`prove-provider-and-storage-packaging.md` 明确结论为"未通过，且尚未开始实测"——无法证明 `node:sqlite` 可在 Packaged Utility Process 中满足 WAL、事务和恢复要求，也无法证明 Provider Secret 可以在不泄露到 Renderer 或 Project Shell 的前提下传递给 Codex Runtime。
3. **M1 纵向切片边界未确定**：在 Runtime、Provider 和 Storage 基线验证通过之前，无法确定 M1 应选择哪条最小可观察路径作为唯一纵向切片。

开发者需要一个明确的、可执行的 Spike 计划，在不开始 M1 产品实施的前提下，产出可审查的 Artifact 并定义明确的停止条件，以判断能否从设计仓库进入实现。

## Solution

执行一个分两阶段的 Implementation Readiness Spike，产出可审查的 Artifact 目录和明确的 Go/No-Go 结论：

**Phase A — M0 Protocol & Provider Spike**：固定 Codex App Server Binary，完成协议握手、Thread lifecycle、Turn control、Approval、Review Subagent 和 MCP 的黑盒验证；同时对自建 Responses-compatible Provider 执行 Probe。产出 Schema Hash、脱敏 JSONL Trace、Provider Probe Report 和失败用例输出。

**Phase B — Windows Storage & Packaging Spike**：在固定 Electron 版本的 Packaged Utility Process 中验证 `node:sqlite` 的 WAL、事务回滚、外键和并发读取；用 sentinel token 验证 Provider Secret 从受控认证 Helper 到 Codex Runtime 的传递链路，并确认 Renderer、Project Shell、日志、诊断包和继承环境均不泄露凭据。产出最小 NSIS 和 Portable 制品形态。

两个 Phase 全部通过后，依据 M0 Artifact 和 M1 纵向切片定义，产出 M1 边界决策记录。Spike 通过不替代后续 M2 恢复 Gate 或 M5 签名/发布 Gate。

## User Stories

1. 作为 Workbench 开发者，我想要固定一个 Codex App Server Binary 版本并完成 initialize handshake，以便确认协议握手在目标 Windows x64 环境中可用。
2. 作为 Workbench 开发者，我想要生成并保存与固定 Codex 版本对应的 TypeScript Types 和 JSON Schema，以便后续实现可以引用稳定的类型定义。
3. 作为 Workbench 开发者，我想要生成并保存 Schema Hash，以便检测 Codex 升级后协议是否发生了变化。
4. 作为 Workbench 开发者，我想要执行 thread/start、thread/resume 和 thread/fork 的协议测试，以便确认 Thread lifecycle 在 MVP 所需范围内可用。
5. 作为 Workbench 开发者，我想要执行 turn/start、turn/steer 和 turn/interrupt 的协议测试，以便确认 Turn 控制在 MVP 所需范围内可用。
6. 作为 Workbench 开发者，我想要验证 Command/File/Network/MCP Approval 请求可以暂停并正确响应，以便确认 Approval 机制可用于安全边界。
7. 作为 Workbench 开发者，我想要验证两个 Reviewer Subagent 的事件、取消和完成可以被观测，以便确认独立 Final Review 的协议基础存在。
8. 作为 Workbench 开发者，我想要确认 WebSocket、process/*、动态工具和分页历史等 experimental API 不进入 MVP 基线，以便避免依赖不稳定接口。
9. 作为 Workbench 开发者，我想要执行 App Server 断流测试并确认不会自动重发最后一次输入，以便保证恢复语义安全。
10. 作为 Workbench 开发者，我想要对自建 Provider 的 base_url + model_id 执行 Responses Streaming Probe，以便确认 SSE 流式响应可用。
11. 作为 Workbench 开发者，我想要对自建 Provider 执行无副作用 Tool Calling Probe，以便确认模型具备工具调用能力。
12. 作为 Workbench 开发者，我想要在 Provider 地址、凭据或模型变化后使 Probe 结果失效，以便防止使用过期兼容性结论。
13. 作为 Workbench 开发者，我想要在固定 Electron 版本的 Packaged Utility Process 中验证 node:sqlite 的 WAL 模式可用，以便确认满足持久化写入需求。
14. 作为 Workbench 开发者，我想要在 Packaged Utility Process 中验证 SQLite 事务回滚，以便确认崩溃后数据一致性可保证。
15. 作为 Workbench 开发者，我想要在 Packaged Utility Process 中验证 SQLite 外键约束生效，以便确认数据完整性约束可用。
16. 作为 Workbench 开发者，我想要在 Packaged Utility Process 中验证并发读取不阻塞写入，以便确认多 Task 场景下数据库可用。
17. 作为 Workbench 开发者，我想要用 sentinel token 验证 Provider Secret 从受控认证 Helper 到 Codex Runtime 的传递链路，以便确认凭据传递路径安全。
18. 作为 Workbench 开发者，我想要验证 Renderer 进程无法访问 Provider Secret，以便确认 Renderer 隔离边界有效。
19. 作为 Workbench 开发者，我想要验证 Project Shell 环境不包含 Provider Secret，以便确认 Agent Shell 不会意外泄露凭据。
20. 作为 Workbench 开发者，我想要验证日志和诊断包中不包含 Provider Secret，以便确认诊断输出安全。
21. 作为 Workbench 开发者，我想要验证 Utility Process 不会默认继承父进程的全部环境变量，以便确认需要显式 allowlist 环境而非依赖继承。
22. 作为 Workbench 开发者，我想要生成最小 NSIS Installer 制品，以便确认 Windows 安装包构建链路可行。
23. 作为 Workbench 开发者，我想要生成最小 Portable EXE 制品，以便确认 Windows 便携版构建链路可行。
24. 作为 Workbench 开发者，我想要验证 NSIS 和 Portable 两种制品的数据目录不互相污染，以便确认两种模式可以共存。
25. 作为 Workbench 开发者，我想要在 M0 全部通过后定义 M1 纵向切片的精确边界，以便确定从 Project Scan 到 Renderer 重载恢复的最小可观察路径。
26. 作为 Workbench 开发者，我想要明确 M1 纵向切片每个环节的最小 UI、持久化 Event、Fixture 和 Gate 证据，以便 M1 实施有明确的验收标准。
27. 作为 Workbench 开发者，我想要明确 M1 延后到 M2/M3 的能力，以便避免在纵向切片中引入不必要的复杂性。
28. 作为 Workbench 开发者，我想要定义 M0 的停止条件（哪些失败必须阻止而非绕过），以便在 Spike 失败时有明确的 No-Go 判据。
29. 作为 Workbench 开发者，我想要在协议漂移时阻止 Spike 继续，以便避免基于不稳定接口做后续决策。
30. 作为 Workbench 开发者，我想要在 Tool Calling 或 Streaming 支持缺失时阻止 Spike 继续，以便确认 Provider 具备最低 Agent 能力。
31. 作为 Workbench 开发者，我想要在凭据泄露时阻止 Spike 继续，以便安全边界问题在早期暴露。
32. 作为 Workbench 开发者，我想要在 Packaged SQLite 不可用时阻止 Spike 继续，以便确认持久化基线可行。
33. 作为 Workbench 开发者，我想要在断流后输入状态不确定时阻止 Spike 继续，以便确认恢复语义可预测。
34. 作为 Workbench 开发者，我想要所有 Spike Artifact 进入 release-evidence/ 目录，以便后续 Gate 可以引用前置验证结果。
35. 作为 Workbench 开发者，我想要 Spike 产出 Go/No-Go 决策记录，以便明确是否可以开始 M1 产品实施。

## Implementation Decisions

### 总体策略

- Spike 分为 Phase A（协议与 Provider）和 Phase B（Storage 与 Packaging），两个 Phase 可以并行执行，但 M1 边界定义依赖两者全部通过。
- Spike 不实现任何产品功能代码（不写 Workflow Engine、不写 Task Manager、不写 UI 组件），只验证平台可行性和协议边界。
- 所有验证产出进入 `release-evidence/` 目录，结构遵循 `release-gates.md` 定义的 Release Evidence 布局。

### Phase A — 协议与 Provider Spike

- **Codex Binary 固定**：使用一个固定版本的 Codex App Server Binary，记录版本号、来源地址和 SHA256。Binary 下载遵循 Runtime Manifest 规范（官方地址、镜像、断点续传、离线导入）。
- **协议传输层**：只使用默认 stdio JSONL 双向 JSON-RPC 连接。WebSocket、process/*、动态工具和分页历史等 experimental API 不进入 Spike 范围，也不进入 MVP 基线。
- **协议验证范围**：initialize、thread/start|resume|fork、turn/start|steer|interrupt、Approval（Command/File/Network/MCP）、review/start、Skill 和 MCP API。
- **Schema 生成**：从固定 Codex Binary 生成 TypeScript Types 和 JSON Schema，计算 Schema Hash 并保存。Schema Hash 用于后续版本对比检测协议漂移。
- **JSONL Trace**：执行 initialize -> thread/start -> turn/start -> steer -> interrupt 的脱敏 JSONL 黑盒 Trace。Trace 不包含任何 Secret 或敏感凭据。本研究不运行会产生 Rollout 的调用。
- **Provider Probe**：对 Provider Profile（base_url + model_id）执行无副作用探针，验证 OpenAI Responses API 兼容性、SSE Streaming 和 Tool Calling。探针以 Profile + model ID 为粒度；地址、凭据或模型变化后失效。
- **断流测试**：模拟 App Server 断流（进程杀死或 stdio 中断），确认不会自动重发最后一次输入，且恢复时需要查询状态而非盲目重发。
- **Reviewer Subagent 验证**：启动两个 Reviewer Subagent，观测其事件流、取消行为和完成信号。

### Phase B — Storage 与 Packaging Spike

- **Electron 版本固定**：使用一个固定的 Electron 版本和对应的 Node.js 版本，记录版本号和来源。
- **Utility Process 验证**：在 Packaged（非开发态 Unpacked）Electron Utility Process 中验证 `node:sqlite DatabaseSync`：
  - `journal_mode=WAL`、`synchronous=FULL`、`foreign_keys=ON`、`trusted_schema=OFF` 初始化验证。
  - 事务回滚：写入中途失败后确认数据回滚到一致状态。
  - 外键约束：验证 ON DELETE CASCADE 等约束生效。
  - 并发读取：多个读取连接不阻塞写入连接。
  - Busy Timeout 验证。
- **Provider Secret 隔离验证**：
  - Secret 存放在 Workbench 私有配置目录（模拟 `.env`），设置最小文件 ACL。
  - 受控认证 Helper 读取 Secret 并只输出 Token 给 Codex Runtime。
  - 使用 sentinel token（一个可被 grep 检索的唯一标记字符串）验证以下位置均不包含该 token：
    - Renderer 进程环境
    - Project Shell 环境变量
    - 日志文件
    - 诊断包
    - Utility Process 继承的父进程环境
  - Utility Process 默认继承父进程环境的问题需要显式 allowlist 解决，不能把 Secret 放入继承环境。
- **最小制品构建**：
  - 使用 electron-vite + electron-builder 生成最小 NSIS Installer 和 Portable EXE。
  - 验证 Installed 数据位于 `%LOCALAPPDATA%/<product>/`，Portable 数据位于 EXE 同级 `data/`。
  - 验证两种模式的数据目录不互相污染。
  - 制品不需要签名（签名属于 M5 Gate）。

### M1 纵向切片边界定义

M0 全部通过后，依据 M0 Artifact 定义 M1 纵向切片：

- **切片路径**：Project Scan -> Task 创建 -> Integration Worktree -> Turn 执行 -> Approval -> Diff -> 验证 -> Renderer 重载恢复。
- **最小 UI**：左侧 Project/Task 列表，中间 Timeline + Composer，右侧 Context/Artifact/Diff/Approval 面板。
- **最小持久化**：Normalized Event、Projection、Attention Outbox 同事务提交。
- **最小 Fixture**：一个 TypeScript/npm 项目的简单代码修改和测试执行。
- **最小 Gate 证据**：Event Trace、Git Diff、验证输出和恢复前后 Task ID。
- **延后到 M2/M3 的能力**：完整恢复协调、故障注入矩阵、Ticket DAG 调度、Child Task 并行、独立 Final Review、Integration Preflight。

### 回退结论

- 如果 `node:sqlite` 在 Packaged Utility Process 中不可用，发布前整体切换到 `better-sqlite3`，不同时交付两套驱动。
- 如果 Codex App Server 协议在固定版本上不稳定，记录限制并评估是否需要等待上游修复或调整 MVP 范围。
- 如果自建 Provider 不具备 Tool Calling 或 Streaming 能力，Probe 失败，Spike 不继续。

## Testing Decisions

### 测试哲学

- 只测试外部行为，不测试实现细节。Spike 验证的是平台能力和协议边界，不是内部代码结构。
- 所有验证以黑盒方式进行：启动进程、发送协议消息、观测输出、检查 Artifact。
- 失败结果必须保留，不能用"理论可运行"代替。

### 测试 Seam

使用单一最高层 seam：一个端到端 Spike 验证脚本（PowerShell 7、UTF-8），以黑盒方式驱动整个 M0+M1 前置验证路径。该脚本对应 `release-gates.md` 中 Gate 0（协议与 Provider Spike）和 Gate 1（单 Task 纵向切片）的前置子集。

脚本产出全部进入 `release-evidence/` 目录，至少包含：
- `protocol-trace/` — 脱敏 JSONL Trace
- `schema-hash.txt` — Schema Hash
- `provider-probe-report.json` — Provider Probe 结果
- `sqlite-packaged-test.json` — SQLite Packaged 验证结果
- `secret-isolation-report.json` — Secret 隔离验证结果
- `build-manifest.json` — 制品构建清单
- `failure-injection/` — 失败用例输出
- `go-no-go-decision.md` — Go/No-Go 决策记录

### 验证范围

- **协议验证**：initialize handshake、Thread lifecycle、Turn control、Approval、Review Subagent、断流不重发。
- **Provider 验证**：Responses Streaming、Tool Calling、Probe 失效条件。
- **Storage 验证**：WAL 模式、事务回滚、外键约束、并发读取、Busy Timeout。
- **安全验证**：sentinel token 在 Renderer、Shell、日志、诊断包和继承环境中均不可见。
- **制品验证**：NSIS 和 Portable 最小制品可构建、数据目录隔离。

### 先例

仓库中没有已有的测试先例（纯设计仓库）。Spike 脚本本身将成为仓库的第一个可执行验证脚本，后续 Gate 将在其基础上扩展。

## Out of Scope

- 实现任何产品功能代码（Workflow Engine、Task Manager、UI 组件、Artifact Manager 等）。
- M2 及以后的持久化精确迁移、故障注入脚本和完整数据库模型。
- M3 及以后的 Ticket DAG、Child Task 并行调度和独立审查的完整实现。
- M4/M5 的 Skill Bundle、MCP 透传、签名、自动更新和安装包加固。
- 更改已接受的产品范围或添加第二个 Agent Runtime。
- Codex App Server 的 WebSocket、process/*、动态工具和分页历史等 experimental API。
- 制品签名（属于 M5 Gate）。
- Portable 静默自动更新。
- 自动 Git Push。

## Further Notes

- 本 Spec 是从 `.scratch/mvp-implementation-readiness/` 下的 5 个前置探索文档综合而来，不包含这些文档之外的新的产品或架构决策。
- 领域术语以 `CONTEXT.md` 为准；架构决策必须先查 `docs/adr/`；实现前遵循 `docs/testing/release-gates.md` 的实证 Gate。
- Spike 通过后，M1 纵向切片的具体实施需要新的 Spec 和 Ticket DAG；本 Spec 只定义 M1 的边界，不实施 M1。
- `node:sqlite` 仍属 RC 稳定性，Utility Process 默认继承父进程环境；实现必须显式 allowlist 环境，不能把 Secret 放入继承环境。
- Provider Probe 只能验证协议底线，不代表模型具有可靠 Agent 行为；真实 Workflow Smoke Test 在后续 Gate 中进行。
- 参考 ADR：ADR-0003（使用 Codex 与自建 Model Provider）、ADR-0004（每个 Provider Profile 一个 App Server）、ADR-0005（管理固定 Codex Runtime）、ADR-0009（隔离 Provider Secret）、ADR-0018（使用 Electron Vite 和 Electron Builder）、ADR-0019（使用 Node SQLite 不使用 ORM）、ADR-0021（Packaged Resilience Tests 作为发布 Gate）。
