---
title: Validate Approval mechanism (Command, File, Network, MCP)
id: T-006
labels:
  - ready-for-agent
depends_on:
  - T-003
validates:
  - US-6
impacts: []
---

## Intent

验证 Command/File/Network/MCP Approval 请求可以暂停并正确响应。确认 Approval 机制可用于安全边界。

## Acceptance Criteria

- Command Approval 请求可以暂停 Turn 并等待用户响应。
- File Approval 请求可以暂停并绑定精确路径。
- Network Approval 请求可以暂停并绑定域名。
- MCP Approval 请求可以暂停并绑定 Connector 操作摘要。
- Approval 响应（approve/reject）后 Turn 正确继续或终止。
- 每种 Approval 的 JSONL Trace 已保存到 `release-evidence/protocol-trace/`。
- Trace 不包含 Secret。

## Validation

- 检查 `release-evidence/protocol-trace/` 中存在四种 Approval 类型的 Trace。
- 验证每种 Approval 请求包含对象摘要。
- 验证 reject 后 Turn 终止，approve 后 Turn 继续。

## Impact Scope

- 新增 `release-evidence/protocol-trace/` 中的 Approval Trace 文件。
- 不修改已有文档。
