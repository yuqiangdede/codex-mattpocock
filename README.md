# Coding Agent Workbench

本地 Electron 桌面工作台。当前完成 M1 模拟纵向切片和 M2-01 Agent Manager 进程化；真实 Codex Turn 接入属于 M2-02。

## 目录与运行边界

- `apps/desktop/main`：窗口、白名单 IPC 路由和 Agent Manager 进程监督。
- `apps/desktop/preload`、`renderer`：原有桌面 API 与界面。
- `packages/agent-manager`：Utility Process 入口、唯一数据库写连接和 M1 业务处理。
- `packages/storage`、`git-worktree`：持久化与 Git 操作，仅由 Agent Manager 使用。
- `scripts`、`tests/integration`：初始化、启动及验证入口。
- `cache`：本地测试 Fixture 和隔离数据库；`release-evidence`：验证结果。

构建将 Main、消息客户端和 Agent Manager 打包到 `out/main`。子进程入口相对构建目录解析；测试目录相对项目根目录生成。应用业务数据沿用 Electron `userData`，测试使用项目 `cache` 中独立目录，不打开用户数据库。

## 环境与入口

需要 Windows、PowerShell 7、Git、Node.js 22（本次验证 22.20.0）、npm 和项目声明的 pnpm。依赖位于项目 `node_modules`；Electron 本次验证版本为 35.7.5。`runtime/node/node.exe` 存在时验证脚本优先使用，否则使用 PATH 中的 Node。

已有初始化与启动入口：

```powershell
./scripts/init.ps1
./scripts/start.ps1
```

先准备好 pnpm 再运行初始化脚本。全新机器初始化及完整发布包迁移本轮 NOT RUN；现有初始化脚本仍需要环境中的 Node/pnpm，这一交付边界尚未在本工单解决。

已有依赖时，构建和开发启动也可直接使用：

```powershell
npm run build
npm run dev
```

无需联网解析依赖的完整本地验证：

```powershell
./scripts/verify.ps1 -Gate integration
```

该入口先检查类型并构建，然后依次运行原有 M1 18 项回归、SQLite 事务回滚、真实 Renderer → Preload → Main → Utility Process 验证和 `WORKBENCH_SMOKE_TEST=1` 冒烟。单独运行 `npm test` 时需先构建。测试保留隔离目录供诊断，不清理用户目录；测试启动的进程在结束时退出。

## M2-01 的验证范围

真实进程验证覆盖 Project、Task、Worktree、模拟 Turn、Approval、Diff、Verify、重载读取；也覆盖请求 ACK/去重、业务错误、Agent Manager 崩溃上报、正常退出和 Main 强杀后的重开。

正常退出先持久化中断状态、关闭数据库，再退出子进程。Windows/Electron 强杀 Main 时可能同时终止 Utility Process，无法保证 JavaScript 在退出前执行；重开后将遗留 `RUNNING` 标为 `INTERRUPTED / UNCERTAIN`，不自动重发。该保护不替代 03 工单的完整恢复协调。

当前 Turn 仍生成固定 `hello()` 示例，不代表真实 Codex/Provider 已接入。正式安装包、完整安全门禁和人工界面验收本轮 NOT RUN。

实施证据见 [.scratch/m2-implementation/validation-01.md](.scratch/m2-implementation/validation-01.md)，后续依赖见 [M2 工单表](.scratch/m2-implementation/dag.md)。
