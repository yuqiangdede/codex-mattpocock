---
title: Scaffold the Electron + pnpm workspace project structure
id: T-001
labels:
  - ready-for-agent
depends_on: []
validates:
  - US-22, US-23
impacts:
  - 全部后续 Ticket 依赖此脚手架
---

## Intent

搭建项目脚手架：pnpm Workspaces + TypeScript Project References、electron-vite 构建 Main/Preload/Renderer、electron-builder 配置、标准脚本契约（`scripts/init.ps1`、`scripts/start.ps1`、`scripts/verify.ps1`）。脚手架不实现任何产品功能代码，只提供可构建的最小 Electron 工程。

## Acceptance Criteria

- `pnpm install` 成功，workspace 依赖解析正确。
- `scripts/init.ps1` 存在且可执行，完成项目内依赖安装和开发环境初始化。
- `scripts/start.ps1` 存在且可执行，能启动开发态 Electron 应用（空白窗口即可）。
- `scripts/verify.ps1` 存在且可执行，能运行分层验证（空 pass 即可）。
- 目录结构遵循 `docs/architecture/coding-agent-architecture.md` 中定义的布局（`apps/desktop/{main,preload,renderer}`、`packages/*`）。
- TypeScript Project References 配置正确，`tsc --build` 无错误。
- electron-vite 构建配置存在，能打包 Main/Preload/Renderer。
- electron-builder 配置存在，NSIS 和 Portable target 已声明（不需要实际签名）。
- 脚本不默认依赖全局 Node、Python 或隐藏路径。

## Validation

- 运行 `scripts/init.ps1`，确认退出码 0。
- 运行 `scripts/verify.ps1`，确认退出码 0。
- 运行 `pnpm tsc --build`，确认无类型错误。
- 运行 electron-vite build，确认产出 Main/Preload/Renderer bundle。

## Impact Scope

- 新增 `package.json`、`pnpm-workspace.yaml`、`tsconfig.json`、`apps/desktop/`、`packages/`、`scripts/`。
- 不修改 `docs/`、`CONTEXT.md`、`AGENTS.md` 或 `.scratch/` 中的任何已有文档。
