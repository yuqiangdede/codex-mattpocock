---
title: Validate Turn control protocol (start, steer, interrupt)
id: T-005
labels:
  - ready-for-agent
depends_on:
  - T-003
validates:
  - US-5
impacts:
  - T-008
---

## Intent

执行 turn/start、turn/steer 和 turn/interrupt 的协议测试，确认 Turn 控制在 MVP 所需范围内可用。生成脱敏 JSONL Trace。

## Acceptance Criteria

- `turn/start` 成功启动 Turn 并返回 Turn ID。
- `turn/steer` 成功向运行中 Turn 注入即时输入。
- `turn/interrupt` 成功中断运行中 Turn。
- 每个操作的请求和响应 JSONL Trace 已保存到 `release-evidence/protocol-trace/`。
- Trace 不包含 Secret 或敏感凭据。
- Steer 在 Timeline 中明确标记为即时调整，而非普通 Queued Input。

## Validation

- 检查 `release-evidence/protocol-trace/` 中存在 Turn 相关的 JSONL Trace 文件。
- 验证 turn/start 返回 Turn ID。
- 验证 turn/interrupt 后 Turn 状态变为 interrupted 或等效终态。

## Impact Scope

- 新增 `release-evidence/protocol-trace/` 中的 Turn control Trace 文件。
- 不修改已有文档。
