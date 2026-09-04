---
title: Coding Agent Workbench MVP implementation-readiness map
labels:
  - wayfinder:map
---

## Destination

在不改变已接受 MVP 范围的前提下，确定能否从设计仓库进入实现，并形成从 M0 Protocol / Provider Spike 到 M1 单 Task 纵向切片的可执行前置决策。

## Notes

领域术语以 `CONTEXT.md` 为准；架构决策必须先查 `docs/adr/`；实现前遵循 `docs/testing/release-gates.md` 的实证 Gate。此地图只处理设计到实现的前置决策，不实施产品功能。

## Decisions so far

<!-- Closed tickets appear here as one-line links. -->

## Not yet specified

- M2 以后持久化/恢复的精确迁移、故障注入脚本和数据库模型，取决于 M0 与 M1 的真实运行证据。
- M3 以后 Ticket DAG、Child Task 和独立审查的调度细节，取决于已验证的 Runtime Session 与事件模型。
- M4/M5 的 Skill、MCP、签名、更新和安装包加固，待前序运行时边界稳定后再拆分。

## Out of scope

- 更改已接受的产品范围、添加第二个 Agent Runtime，或直接实现 UI/业务代码；这些不是本次就绪度分析的产物。
