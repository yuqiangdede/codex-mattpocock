---
title: Validate node:sqlite in Packaged Electron Utility Process
id: T-011
labels:
  - ready-for-agent
depends_on:
  - T-001
validates:
  - US-13, US-14, US-15, US-16, US-32
impacts: []
---

## Intent

在固定 Electron 版本的 Packaged（非开发态 Unpacked）Utility Process 中验证 `node:sqlite DatabaseSync` 的 WAL 模式、事务回滚、外键约束、并发读取和 Busy Timeout。

## Acceptance Criteria

- `journal_mode=WAL` 初始化验证通过。
- `synchronous=FULL` 初始化验证通过。
- `foreign_keys=ON` 初始化验证通过。
- `trusted_schema=OFF` 初始化验证通过。
- 事务回滚测试通过：写入中途失败后数据回滚到一致状态。
- 外键约束测试通过：ON DELETE CASCADE 等约束生效。
- 并发读取测试通过：多个读取连接不阻塞写入连接。
- Busy Timeout 验证通过。
- 所有测试结果已保存到 `release-evidence/sqlite-packaged-test.json`。
- 如果 Packaged SQLite 不可用，Spike 停止（停止条件 US-32），并记录回退到 `better-sqlite3` 的结论。

## Validation

- 检查 `release-evidence/sqlite-packaged-test.json` 存在且 JSON 格式正确。
- 验证所有测试项（WAL、synchronous、foreign_keys、trusted_schema、事务回滚、外键、并发读取、Busy Timeout）均为 pass。
- 验证测试在 Packaged 环境（非 Unpacked 开发态）中执行。

## Impact Scope

- 新增 `release-evidence/sqlite-packaged-test.json`。
- 可能新增 `packages/storage/` 中的 SQLite 验证脚本。
- 不修改已有文档。
