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

## 环境坑位（Windows，本仓库已踩）

- **pnpm 必置 `CODEBUDDY_SAFE_DELETE_ENABLED=0`**：否则 safe-delete guard 触发；`node-linker=hoisted` 下残留 `.pnpm` 虚拟存储会导致 EPERM rmdir。
- **electron/esbuild 构建脚本**：`pnpm-workspace.yaml` 需 `allowBuilds: true`，装完跑 `pnpm rebuild electron esbuild`。package.json 里的 `pnpm.onlyBuiltDependencies` 已废弃，不要用。
- Electron 33/34 内嵌 Node 20 **不支持** `node:sqlite`，必须 Electron 35+（Node 22）。已升到 35.7.5。
- Provider（api.qnaigc.com）**不支持** OpenAI Responses API（404），只支持 Chat Completions；Probe 用双端点降级。Turn 的 UserInput 格式是 `{type:"text",text:"...",text_elements:[]}`，不是 message/content 包装。
- `dist-build/`、`dist-release/`（515MB T-013 制品）已 gitignore，`runtime/` 与 `cache/` 同理。

## 里程碑状态（截至 2026-09-05）

- **M0 Spike 完成**：T-001~T-017 全 PASS，Go 决策在 `release-evidence/go-no-go-decision.md`，5 个停止条件全未触发。
- **M1 纵向切片完成**：commit `b4e85b2`，8 步全通，E2E 18/18，冒烟退出 0。代码在 `packages/{shared,storage,git-worktree}` + `apps/desktop/{main,preload,renderer}`。
  - **注意**：M1 是直写代码完成的，**未经** to-spec → to-tickets → implement 流程。
  - `packages/{agent-manager,workflow,runtime-codex,protocol}` 仍是 `export {}` 占位符。
- **M2 工单 DAG 已发布**：7 个工单在 `.scratch/m2-implementation/issues/01~07-*.md`，拓扑图 `dag.md`。全部 `ready-for-agent`。
- **setup-matt-pocock-skills 不需要重跑**：AGENTS.md + `docs/agents/{issue-tracker,triage-labels,domain}.md` 已在位，triage 技能已安装。`setup-matt-pocock-skills` 前置条件已满足。

## 工单与文档约定

- 本地工单位置 `.scratch/<feature>/issues/<NN>-<slug>.md`，编号 `01` 起按依赖顺序（blockers 在前）。配套 `dag.md` 记录拓扑与 frontier。
- 领域术语以 `CONTEXT.md` 为准（Project / Task / Runtime Session / Artifact / Spec / Ticket / Approval 等均有精确定义与 Avoid 词）。**改代码前先查 CONTEXT.md 词汇表**。
- 架构决策先查 `docs/adr/`（26 个 ADR）；验证标准查 `docs/testing/release-gates.md`（Gate 0~5）。
