---
title: Validate App Server disconnect does not auto-replay last input
id: T-008
labels:
  - ready-for-agent
depends_on:
  - T-004
  - T-005
validates:
  - US-9, US-33
impacts: []
---

## Intent

模拟 App Server 断流（进程杀死或 stdio 中断），确认不会自动重发最后一次输入，且恢复时需要查询状态而非盲目重发。

## Acceptance Criteria

- App Server 进程被杀死后，最后一次输入不会被自动重发。
- 重连后系统查询 Thread/Turn 状态而非盲目重发。
- 未确认执行完成的输入标记为 Uncertain Input。
- 断流和恢复的 JSONL Trace 已保存到 `release-evidence/failure-injection/`。
- Trace 不包含 Secret。
- 如果断流后输入状态不确定，Spike 停止（停止条件 US-33）。

## Validation

- 检查 `release-evidence/failure-injection/` 中存在断流测试 Trace。
- 验证恢复后没有重发最后一次输入的协议消息。
- 验证恢复流程包含状态查询（而非直接重发 turn/start）。

## Impact Scope

- 新增 `release-evidence/failure-injection/` 中的断流测试文件。
- 不修改已有文档。
