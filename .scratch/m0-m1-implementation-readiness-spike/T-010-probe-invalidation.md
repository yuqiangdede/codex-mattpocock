---
title: Validate Provider Probe invalidation on config change
id: T-010
labels:
  - ready-for-agent
depends_on:
  - T-009
validates:
  - US-12
impacts: []
---

## Intent

验证 Provider 地址、凭据或模型变化后 Probe 结果失效，防止使用过期兼容性结论。

## Acceptance Criteria

- 修改 base_url 后，已有 Probe 结果标记为失效。
- 修改 model_id 后，已有 Probe 结果标记为失效。
- 修改凭据后，已有 Probe 结果标记为失效。
- 失效后需要重新执行 Probe 才能使用新配置。
- 验证结果已保存到 `release-evidence/provider-probe-report.json`（追加 invalidation 测试记录）。

## Validation

- 检查 `release-evidence/provider-probe-report.json` 中包含 invalidation 测试记录。
- 验证三种变化（base_url、model_id、凭据）都触发了失效。

## Impact Scope

- 更新 `release-evidence/provider-probe-report.json`。
- 不修改已有文档。
