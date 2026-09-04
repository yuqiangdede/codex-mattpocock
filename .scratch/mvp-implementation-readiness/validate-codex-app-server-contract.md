---
title: Validate the pinned Codex App Server contract
labels:
  - wayfinder:research
parent: map.md
blocking: []
status: closed
---

## Question

针对一个固定的 Windows Codex App Server Bundle，哪些稳定 API 能满足 M0 所需的 initialize、thread lifecycle、turn control、approval、review、skills、MCP 与恢复协调？哪些调用或传输层是 experimental，必须从 MVP 的生产路径剔除或单独 Gate？输出版本、Schema Hash、最小 JSONL Trace 和已知限制。

## Resolution

以当前官方 App Server 文档为准，M0 只承诺默认 `stdio` 的 JSONL 双向 JSON-RPC 连接，以及公开的 `initialize`、`thread/start|resume|fork`、`turn/start|steer|interrupt`、Approval、`review/start`、Skill 和 MCP API。WebSocket、`process/*`、动态工具、分页历史和其他要求 `experimentalApi` 的功能不进入 MVP 基线。每个固定 Bundle 必须生成并保存对应 Schema Hash，并执行 `initialize → thread/start → turn/start → steer → interrupt` 的脱敏 JSONL 黑盒 Trace；本研究没有运行会产生 Rollout 的调用，因此这是一项未执行的验收清单。

参考：[Codex App Server Protocol](https://developers.openai.com/codex/app-server/#protocol)、[Experimental API opt-in](https://developers.openai.com/codex/app-server/#experimental-api-opt-in)。
