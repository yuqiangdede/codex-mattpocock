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
- **含斜杠的 git 引用在 agent 沙箱内建不出来**（是沙箱伪影，**不是**仓库/磁盘/git 缺陷）：沙箱里 `git branch task/x`、`git update-ref refs/heads/a/b`、`git tag t1/x` 静默失败（退出码 0 但无 ref），`git worktree add -b task/x` 报 `fatal: invalid reference`；不带斜杠的名字正常。同一命令同一仓库，命令被提权跑到沙箱外就全绿（看输出里有没有 `Sandbox bypassed` 横幅）。git 二进制不是变量（PortableGit 2.55 / 系统 Git 2.51 同结论）。
  - 判定工具：`.scratch/m2-implementation/repro-08.mjs`（RED=你在沙箱里，别在这跑建 worktree / 建 `task/<id>` 分支的操作）。
  - **不阻塞任何工单**：M2-05 与 M1 E2E 都能在沙箱外跑通，M1 E2E 实测 18/18。
  - 详见 `.scratch/m2-implementation/issues/08-slashed-ref-creation-failure.md`。
- **给 git.exe 传路径不要用 MSYS 形式**：`/d/code/x`、`/tmp/x` 会被当 Win32 字面路径，`git clone` 报 "does not exist" 并在 `D:\d\...`、`C:\tmp\...` 造残留目录。用 `D:/code/...`，目标路径用相对路径。

## 里程碑状态（截至 2026-09-06）

- **M0 Spike 完成**：T-001~T-017 全 PASS，Go 决策在 `release-evidence/go-no-go-decision.md`，5 个停止条件全未触发。
- **M1 纵向切片完成**：commit `b4e85b2`，8 步全通，E2E 18/18，冒烟退出 0。代码在 `packages/{shared,storage,git-worktree}` + `apps/desktop/{main,preload,renderer}`。
  - **注意**：M1 是直写代码完成的，**未经** to-spec → to-tickets → implement 流程。
- **M2-01 完成**：commit `1c5661e`。Agent Manager 迁入独立 Utility Process，Event Store 接管。M1 E2E 回归通过。
- **M2-02 完成**：commit `dd9a711`。Runtime Session 接入真实 Codex App Server：移除 M1 模拟 Turn，写入协议客户端、受控认证 Helper、按 Profile 复用进程、Task→Thread 映射、approval 路由回真实 serverRequestId。`packages/runtime-codex` 从占位变成完整实现。runtime-codex 集成测试 19 PASS / 0 FAIL / 3 SKIPPED（thread/resume + 流式 Agent 消息需真实 Provider 凭据/turn 落地）。
- **M2-03~07 完成**：03 持久化恢复协调、05 DAG 调度、06 Final Review、07 Integration Preflight 均 completed。
- **M2-04 in-progress**：故障注入矩阵 6 PASS / 5 SANDBOX-BLOCKED / 0 NOT RUN。NOT RUN 项（App Server Kill、Provider SSE 中断、Event/Artifact 不一致、Skill 离线）已全部补齐为 PASS。5 项 SANDBOX-BLOCKED 需在沙箱外重跑确认（根因是 agent 沙箱内 git 无法创建 `task/<id>` 分支，非代码缺陷）。

## Runtime-codex 集成要点（本仓库已落地）

- **Provider Secret 受控认证**：Profile 仅存元数据（baseUrl、modelId、secretEnvKey、wireApi）；Secret 落在 `dataDir/runtime-config/<profile-id>.secret`。Codex App Server 子进程环境用 `CHILD_ENV_ALLOWLIST`（13 keys）显式 allowlist，绝不继承父进程全量变量。对应 T-012 sentinel 检查点。
- **App Server 进程复用**：`RuntimeSessionManager.serverFor(profile)` 用 Promise + Map 保证同一 Profile 并发请求只起一次进程；不同 Profile 各自独立 App Server；Task 维度共享同一 Profile 的进程。
- **协议 Schema Hash**：`packages/protocol/src/index.ts` 里 `CODEX_SCHEMA_HASH = 8424cf18...`，与 `release-evidence/schema-hash.txt` 一致；runtime-codex 集成测试用真实 binary 时校验。
- **protocol package 出口**：`@workbench/protocol` 提供 JSON-RPC 帧类型、initialize/thread/turn/approval 的请求/响应/通知类型、ServerRequest / ServerNotification / ApprovalDecision 等。`AppServer.jsonrpc 实际只暴露 JSON 帧，不持有业务语义。
- **Provider wire_api 实测只有 `responses`**：之前 shared 类型写了 `responses | chat_completions` 是错的，按 `Config.wireApi` schema 收紧成单值。
- **App Server 子进程**：`runtime/codex.exe`（Spike T-002 固定二进制）；`CODEX_APP_SERVER_ARGS = ["app-server"]`；transport 固定 stdio JSONL。
- **setup-matt-pocock-skills 不需要重跑**：AGENTS.md + `docs/agents/{issue-tracker,triage-labels,domain}.md` 已在位，triage 技能已安装。`setup-matt-pocock-skills` 前置条件已满足。

## 工单与文档约定

- 本地工单位置 `.scratch/<feature>/issues/<NN>-<slug>.md`，编号 `01` 起按依赖顺序（blockers 在前）。配套 `dag.md` 记录拓扑与 frontier。
- 领域术语以 `CONTEXT.md` 为准（Project / Task / Runtime Session / Artifact / Spec / Ticket / Approval 等均有精确定义与 Avoid 词）。**改代码前先查 CONTEXT.md 词汇表**。
- 架构决策先查 `docs/adr/`（26 个 ADR）；验证标准查 `docs/testing/release-gates.md`（Gate 0~5）。
