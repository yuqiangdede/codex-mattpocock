---
title: Integrate all Spike validations into a single PowerShell verify script
id: T-015
labels:
  - ready-for-agent
depends_on:
  - T-003
  - T-004
  - T-005
  - T-006
  - T-007
  - T-008
  - T-009
  - T-010
  - T-011
  - T-012
  - T-013
  - T-014
validates:
  - US-34
impacts:
  - T-016
---

## Intent

将所有 Spike 验证整合为一个端到端 PowerShell 7、UTF-8 验证脚本（对应 `scripts/verify.ps1` 的 Spike 分层）。脚本以黑盒方式驱动整个 M0+M1 前置验证路径，产出全部进入 `release-evidence/` 目录。

## Acceptance Criteria

- `scripts/verify.ps1` 支持 `--gate spike` 参数，执行全部 Spike 验证。
- 脚本按正确顺序执行所有验证（尊重依赖关系）。
- 脚本产出全部进入 `release-evidence/` 目录，至少包含：
  - `protocol-trace/` — 脱敏 JSONL Trace
  - `schema-hash.txt` — Schema Hash
  - `provider-probe-report.json` — Provider Probe 结果
  - `sqlite-packaged-test.json` — SQLite Packaged 验证结果
  - `secret-isolation-report.json` — Secret 隔离验证结果
  - `build-manifest.json` — 制品构建清单
  - `failure-injection/` — 失败用例输出
- 脚本退出码为 0 表示全部通过，非 0 表示有失败项。
- 脚本不默认依赖全局 Node、Python 或隐藏路径。
- 失败结果保留，不能用"理论可运行"代替。

## Validation

- 运行 `scripts/verify.ps1 --gate spike`，确认退出码 0。
- 检查 `release-evidence/` 目录包含所有预期文件。
- 检查脚本输出包含每项验证的 pass/fail 状态。

## Impact Scope

- 更新 `scripts/verify.ps1`。
- 可能新增 `scripts/spike/` 下的子脚本。
- 不修改已有文档。
