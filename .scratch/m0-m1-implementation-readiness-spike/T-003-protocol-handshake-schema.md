---
title: Validate Codex App Server initialize handshake and generate Schema
id: T-003
labels:
  - ready-for-agent
depends_on:
  - T-002
validates:
  - US-1, US-2, US-3, US-8
impacts:
  - T-004, T-005, T-006, T-007, T-008
---

## Intent

启动固定 Codex App Server，完成 initialize handshake。从固定 Binary 生成 TypeScript Types 和 JSON Schema，计算 Schema Hash 并保存。确认 WebSocket、process/*、动态工具和分页历史等 experimental API 不进入 MVP 基线。

## Acceptance Criteria

- App Server 通过 stdio JSONL 启动并完成 initialize handshake。
- 生成的 TypeScript Types 和 JSON Schema 已保存到 `release-evidence/protocol-trace/`。
- Schema Hash 已计算并保存到 `release-evidence/schema-hash.txt`。
- 脱敏 JSONL Trace 已保存（initialize 握手部分），不包含任何 Secret 或敏感凭据。
- 已明确记录哪些 API 属于 stable 范围，哪些属于 experimental（不进入 MVP 基线）。
- 传输层只使用默认 stdio JSONL 双向 JSON-RPC，不使用 WebSocket。

## Validation

- 检查 `release-evidence/protocol-trace/` 中存在 TypeScript Types 和 JSON Schema 文件。
- 检查 `release-evidence/schema-hash.txt` 存在且非空。
- 检查 JSONL Trace 不包含 Secret 模式（grep 常见 secret 模式为空）。
- 检查 Trace 中 initialize 请求和响应都存在且 JSON-RPC 格式正确。

## Impact Scope

- 新增 `release-evidence/protocol-trace/` 目录和文件。
- 新增 `release-evidence/schema-hash.txt`。
- 可能新增 `packages/protocol/` 中的类型定义（如果 Schema 生成流程产出代码）。
- 不修改已有文档。
