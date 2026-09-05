# Project Memory

## 术语归属：上游 vs 本仓库

- 上游 https://github.com/mattpocock/skills **不使用** "Spike" 和 "DAG" 这两个词（2026-09 核对 README 及 ask-matt / wayfinder / to-tickets / to-spec / implement 原文，零命中）。
- 上游官方等价说法：Spike → `prototype`；DAG → `blocking edges` / `task graph`（见 `.changeset/add-implement-spec-skill.md`）。
- `Spike`、`Ticket DAG`、`Spec Gate`、`Ticket/Skill Snapshot`、`Completion Evidence`、`Review Finding`、`Integration Candidate` 均属本仓库（Coding Agent Workbench）的产品化扩展，不是 Matt Pocock 原方法论。
- 上游官方主流程（据 `skills/engineering/ask-matt/SKILL.md`）：`grill-with-docs → to-spec → to-tickets → implement(tdd + code-review)`；三条入口为 `triage`、`diagnosing-bugs`、`wayfinder`；`domain-modeling` 与 `codebase-design` 是垫在流程之下的词汇层。
- 引用上游概念时优先用官方措辞，并在提及本仓库扩展概念时标明是本仓库术语。

## M1 桌面应用：Workspace 包解析约定（本仓库）

- desktop 三子包路径为 `apps/desktop/{main,preload,renderer}`，各自是独立 package，但**不是** pnpm workspace 顶级成员 —— 顶层 `pnpm-workspace.yaml` 用 `packages: ["apps/*", "apps/*/*", "packages/*"]`，`"apps/*/*"` 一格才把它们纳入。
- `@workbench/*` 本地包在 desktop 子包里靠**两处映射**才能解析（不依赖 node_modules 符号链接，因 pnpm 对嵌套子包可能不建链）：
  1) 根 `tsconfig.json` 的 `paths`（编译期，`tsc --build`）
  2) `electron.vite.config.ts` 的 `resolve.alias`（构建期，electron-vite）
- Electron 35 用 `node:sqlite` DatabaseSync，数据落 `app.getPath("userData")`。冒烟验证：`WORKBENCH_SMOKE_TEST=1 npx electron . --no-sandbox`。
- M1 切片 E2E 验证脚本：`.scratch/m1-e2e/verify.mjs`（写 `release-evidence/m1-slice-e2e.json`），fixture 在 `.scratch/m1-fixture`（TDD 红状态）。
