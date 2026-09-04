---
title: Validate Reviewer Subagent events, cancellation and completion
id: T-007
labels:
  - ready-for-agent
depends_on:
  - T-003
validates:
  - US-7
impacts: []
---

## Intent

启动两个 Reviewer Subagent，观测其事件流、取消行为和完成信号。确认独立 Final Review 的协议基础存在。

## Acceptance Criteria

- `review/start` 成功启动 Review Session。
- 两个 Reviewer Subagent 的事件可以被观测和区分。
- 取消一个 Reviewer 不影响另一个。
- 两个 Reviewer 都能发出完成信号。
- JSONL Trace 已保存到 `release-evidence/protocol-trace/`。
- Trace 不包含 Secret。

## Validation

- 检查 `release-evidence/protocol-trace/` 中存在 Review 相关的 Trace 文件。
- 验证两个 Reviewer 的事件流可以区分（不同 ID 或标识）。
- 验证取消一个 Reviewer 后另一个仍能完成。

## Impact Scope

- 新增 `release-evidence/protocol-trace/` 中的 Review Trace 文件。
- 不修改已有文档。
