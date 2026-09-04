---
title: Validate Thread lifecycle protocol (start, resume, fork)
id: T-004
labels:
  - ready-for-agent
depends_on:
  - T-003
validates:
  - US-4
impacts:
  - T-008
---

## Intent

执行 thread/start、thread/resume 和 thread/fork 的协议测试，确认 Thread lifecycle 在 MVP 所需范围内可用。生成脱敏 JSONL Trace。

## Acceptance Criteria

- `thread/start` 成功创建 Thread 并返回 Thread ID。
- `thread/resume` 成功恢复已有 Thread。
- `thread/fork` 成功从已有 Thread 派生新 Thread。
- 每个操作的请求和响应 JSONL Trace 已保存到 `release-evidence/protocol-trace/`。
- Trace 不包含 Secret 或敏感凭据。
- 本研究不运行会产生 Rollout 的调用。

## Validation

- 检查 `release-evidence/protocol-trace/` 中存在 thread 相关的 JSONL Trace 文件。
- 验证每个操作返回成功状态码。
- 验证 Thread ID 格式一致且可复用（resume 使用 start 返回的 ID）。

## Impact Scope

- 新增 `release-evidence/protocol-trace/` 中的 Thread lifecycle Trace 文件。
- 不修改已有文档。
