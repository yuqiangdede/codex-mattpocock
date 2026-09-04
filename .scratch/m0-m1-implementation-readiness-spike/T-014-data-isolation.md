---
title: Validate NSIS and Portable data directory isolation
id: T-014
labels:
  - ready-for-agent
depends_on:
  - T-013
validates:
  - US-24
impacts: []
---

## Intent

验证 NSIS 和 Portable 两种制品的数据目录不互相污染，确认两种模式可以共存。

## Acceptance Criteria

- NSIS Installed 模式的数据目录（`%LOCALAPPDATA%/<product>/`）和 Portable 模式的数据目录（EXE 同级 `data/`）不共享数据。
- 在一种模式下创建的数据不会出现在另一种模式中。
- Single Instance 在两种模式下各自有效。
- 验证结果已追加到 `release-evidence/build-manifest.json`。

## Validation

- 在 NSIS 模式下创建测试数据，检查 Portable 模式数据目录中不存在该数据。
- 在 Portable 模式下创建测试数据，检查 NSIS 模式数据目录中不存在该数据。
- 检查 `release-evidence/build-manifest.json` 中包含隔离验证记录。

## Impact Scope

- 更新 `release-evidence/build-manifest.json`。
- 不修改已有文档。
