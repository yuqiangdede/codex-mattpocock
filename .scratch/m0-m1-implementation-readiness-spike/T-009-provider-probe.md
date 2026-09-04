---
title: Execute Provider Probe (Responses Streaming + Tool Calling)
id: T-009
labels:
  - ready-for-agent
depends_on:
  - T-001
validates:
  - US-10, US-11
impacts:
  - T-010
---

## Intent

对自建 Provider 的 base_url + model_id 执行无副作用探针，验证 OpenAI Responses API 兼容性、SSE Streaming 和 Tool Calling。探针以 Profile + model ID 为粒度。

## Acceptance Criteria

- Provider Probe 对指定 base_url + model_id 完成 Responses API 兼容性验证。
- SSE Streaming 响应成功接收并解析。
- Tool Calling 探针成功（模型返回有效 tool call，无副作用执行）。
- Provider Probe Report 已保存到 `release-evidence/provider-probe-report.json`。
- Report 包含 base_url、model_id、probe 时间、各项结果和退出码。
- 如果 Tool Calling 或 Streaming 支持缺失，Probe 失败，Spike 不继续（停止条件 US-30）。

## Validation

- 检查 `release-evidence/provider-probe-report.json` 存在且 JSON 格式正确。
- 验证 Report 中 streaming 和 tool_calling 字段均为 pass。
- 验证 Report 中不包含 Secret（只包含 base_url 和 model_id，不包含 API key）。

## Impact Scope

- 新增 `release-evidence/provider-probe-report.json`。
- 可能新增 `packages/runtime-codex/` 中的 Provider Probe 脚本。
- 不修改已有文档。
