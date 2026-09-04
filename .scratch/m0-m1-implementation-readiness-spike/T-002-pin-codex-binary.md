---
title: Pin and verify the Codex App Server Binary download
id: T-002
labels:
  - ready-for-agent
depends_on:
  - T-001
validates:
  - US-1
impacts:
  - T-003, T-004, T-005, T-006, T-007, T-008
---

## Intent

固定一个 Codex App Server Binary 版本，下载并校验完整性。记录版本号、来源地址和 SHA256。Binary 下载遵循 Runtime Manifest 规范（官方地址、镜像、断点续传、离线导入）。

## Acceptance Criteria

- Codex App Server Binary 版本号已记录。
- Binary SHA256 已计算并保存到 `release-evidence/runtime-manifest.json`。
- Binary 可在 Windows x64 上启动（进程启动即退出可接受，不需要完成完整握手）。
- Runtime Manifest JSON 至少包含 `platform`、`arch`、`version`、`sha256`、`sourceUrl` 字段。
- 离线导入路径已验证（从本地文件导入成功）。

## Validation

- 执行 Binary 启动命令，确认进程可以启动。
- 计算 Binary SHA256，与 Manifest 中记录一致。
- 验证离线导入：从本地路径加载 Binary 成功。

## Impact Scope

- 新增 `runtime/` 目录和 Binary 文件。
- 新增 `release-evidence/runtime-manifest.json`。
- 不修改已有文档。
