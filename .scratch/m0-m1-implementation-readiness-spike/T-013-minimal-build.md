---
title: Build minimal NSIS Installer and Portable EXE
id: T-013
labels:
  - ready-for-agent
depends_on:
  - T-001
validates:
  - US-22, US-23
impacts:
  - T-014
---

## Intent

使用 electron-vite + electron-builder 生成最小 NSIS Installer 和 Portable EXE。验证 Windows 安装包和便携版构建链路可行。制品不需要签名（签名属于 M5 Gate）。

## Acceptance Criteria

- NSIS Installer 成功生成，文件存在且非空。
- Portable EXE 成功生成，文件存在且非空。
- Installed 数据位于 `%LOCALAPPDATA%/<product>/`。
- Portable 数据位于 EXE 同级 `data/`。
- 构建清单已保存到 `release-evidence/build-manifest.json`，包含制品路径、大小、构建时间和 electron-builder 版本。
- 制品不包含签名（明确记录"签名属于 M5 Gate"）。

## Validation

- 检查 NSIS Installer 文件存在且大小 > 0。
- 检查 Portable EXE 文件存在且大小 > 0。
- 检查 `release-evidence/build-manifest.json` 存在且 JSON 格式正确。
- 安装 NSIS Installer，验证数据目录位于 `%LOCALAPPDATA%/<product>/`。
- 运行 Portable EXE，验证数据目录位于 EXE 同级 `data/`。

## Impact Scope

- 新增 `release-evidence/build-manifest.json`。
- 新增 `dist/` 或等效输出目录中的制品文件。
- 不修改已有文档。
