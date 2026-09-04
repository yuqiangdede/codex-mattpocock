# Ticket DAG — M0–M1 Implementation Readiness Spike

来源 Spec: [spec.md](spec.md)

## DAG 结构

```text
T-001 项目脚手架
  ├─> T-002 Codex Binary 固定与下载验证
  │     └─> T-003 协议握手与 Schema 生成
  │           ├─> T-004 Thread lifecycle 协议测试
  │           ├─> T-005 Turn control 协议测试
  │           ├─> T-006 Approval 机制验证
  │           ├─> T-007 Reviewer Subagent 验证
  │           └─> T-008 断流不重发验证 (depends: T-004, T-005)
  ├─> T-009 Provider Probe
  │     └─> T-010 Probe 失效条件验证
  ├─> T-011 Packaged SQLite 验证
  ├─> T-012 Provider Secret 隔离验证
  ├─> T-013 最小制品构建
  │     └─> T-014 数据目录隔离验证
  └─> T-015 Spike 验证脚本整合 (depends: T-003..T-014)
        └─> T-016 Go/No-Go 决策记录
              └─> T-017 M1 纵向切片边界定义
```

## 并行执行策略

- **Phase A（协议与 Provider）**：T-002 → T-003 → {T-004, T-005, T-006, T-007} → T-008，以及 T-009 → T-010。两组可以并行。
- **Phase B（Storage 与 Packaging）**：T-011、T-012、T-013 → T-014。三组可以并行。
- **Phase A 和 Phase B 可以完全并行执行**，因为 T-001 是唯一共同前置依赖。
- T-015 依赖全部验证 Ticket 完成后才能执行。
- T-016 依赖 T-015。
- T-017 依赖 T-016 且仅在 Go 决策时执行。

## Ticket 列表

| ID | Title | Depends On | Label |
|---|---|---|---|
| T-001 | Scaffold the Electron + pnpm workspace project structure | — | ready-for-agent |
| T-002 | Pin and verify the Codex App Server Binary download | T-001 | ready-for-agent |
| T-003 | Validate Codex App Server initialize handshake and generate Schema | T-002 | ready-for-agent |
| T-004 | Validate Thread lifecycle protocol (start, resume, fork) | T-003 | ready-for-agent |
| T-005 | Validate Turn control protocol (start, steer, interrupt) | T-003 | ready-for-agent |
| T-006 | Validate Approval mechanism (Command, File, Network, MCP) | T-003 | ready-for-agent |
| T-007 | Validate Reviewer Subagent events, cancellation and completion | T-003 | ready-for-agent |
| T-008 | Validate App Server disconnect does not auto-replay last input | T-004, T-005 | ready-for-agent |
| T-009 | Execute Provider Probe (Responses Streaming + Tool Calling) | T-001 | ready-for-agent |
| T-010 | Validate Provider Probe invalidation on config change | T-009 | ready-for-agent |
| T-011 | Validate node:sqlite in Packaged Electron Utility Process | T-001 | ready-for-agent |
| T-012 | Validate Provider Secret isolation with sentinel token | T-001 | ready-for-agent |
| T-013 | Build minimal NSIS Installer and Portable EXE | T-001 | ready-for-agent |
| T-014 | Validate NSIS and Portable data directory isolation | T-013 | ready-for-agent |
| T-015 | Integrate all Spike validations into a single PowerShell verify script | T-003..T-014 | ready-for-agent |
| T-016 | Produce Go/No-Go decision record | T-015 | ready-for-agent |
| T-017 | Define M1 single-task vertical slice boundary | T-016 | ready-for-agent |

## 停止条件

以下任一条件触发时，Spike 进入 No-Go，不继续后续 Ticket：

| 条件 | 对应 US | 检查 Ticket |
|---|---|---|
| 协议漂移 | US-29 | T-003 |
| Tool Calling 或 Streaming 支持缺失 | US-30 | T-009 |
| 凭据泄露 | US-31 | T-012 |
| Packaged SQLite 不可用 | US-32 | T-011 |
| 断流后输入状态不确定 | US-33 | T-008 |
