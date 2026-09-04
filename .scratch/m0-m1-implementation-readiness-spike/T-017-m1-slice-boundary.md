---
title: Define M1 single-task vertical slice boundary
id: T-017
labels:
  - ready-for-agent
depends_on:
  - T-016
validates:
  - US-25, US-26, US-27
impacts: []
---

## Intent

在 M0 全部通过（Go 决策）后，依据 M0 Artifact 定义 M1 纵向切片的精确边界。明确每个环节的最小 UI、持久化 Event、Fixture 和 Gate 证据，以及延后到 M2/M3 的能力。

## Acceptance Criteria

- M1 切片路径已明确定义：Project Scan -> Task 创建 -> Integration Worktree -> Turn 执行 -> Approval -> Diff -> 验证 -> Renderer 重载恢复。
- 每个环节的最小 UI 已定义：
  - 左侧 Project/Task 列表
  - 中间 Timeline + Composer
  - 右侧 Context/Artifact/Diff/Approval 面板
- 每个环节的最小持久化 Event 已定义：Normalized Event、Projection、Attention Outbox 同事务提交。
- 最小 Fixture 已定义：一个 TypeScript/npm 项目的简单代码修改和测试执行。
- 最小 Gate 证据已定义：Event Trace、Git Diff、验证输出和恢复前后 Task ID。
- 延后到 M2/M3 的能力已明确列出：
  - 完整恢复协调
  - 故障注入矩阵
  - Ticket DAG 调度
  - Child Task 并行
  - 独立 Final Review
  - Integration Preflight
- M1 边界定义已保存到 `.scratch/m0-m1-implementation-readiness-spike/m1-slice-boundary.md`。

## Validation

- 检查 `.scratch/m0-m1-implementation-readiness-spike/m1-slice-boundary.md` 存在。
- 验证文件包含切片路径、最小 UI/Event/Fixture/Gate 证据和延后能力列表。
- 验证切片路径与 `release-gates.md` Gate 1 的通过条件一致。

## Impact Scope

- 新增 `.scratch/m0-m1-implementation-readiness-spike/m1-slice-boundary.md`。
- 不修改已有文档。
