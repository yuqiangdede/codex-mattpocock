# M2 Implementation — Ticket DAG

## Tickets

| # | Title | Blocked by | Status |
|---|-------|-------------|--------|
| 01 | Agent Manager 进程化与 Event Store 接管 | — | completed |
| 02 | Codex Runtime Session 生命周期管理 | 01 | completed |
| 03 | 持久化恢复协调 | 01 | completed |
| 04 | 故障注入验证矩阵 | 03 | in-progress |
| 05 | Ticket DAG 调度与 Child Task | 02 | completed |
| 06 | Independent Final Review | 02, 05 | completed |
| 07 | Integration Preflight | 05, 06 | completed |
| 08 | 含斜杠 git 引用创建失败 — 已定位为 agent 沙箱伪影，非缺陷 | — | closed |

## Dependency graph

```
01 (Agent Manager 进程化)
 ├── 02 (Runtime Session) ──────────────┐
 │                                       │
 └── 03 (恢复协调)                        │
      └── 04 (故障注入矩阵)               │
                                          ├── 05 (DAG 调度) ──┐
                                          │                   ├── 06 (Final Review)
                                          │                   └── 07 (Integration Preflight)
                                          └───────────────────┘
```

## Frontier (can start immediately)

- **04** — 故障注入验证矩阵（in-progress：6 项 PASS、5 项 SANDBOX-BLOCKED、0 项 NOT RUN）

> 03、05、06、07 均已完成。04 的 NOT RUN 项已全部补齐（App Server Kill、Provider SSE 中断、
> Event/Artifact 不一致、Skill 离线均 PASS）。剩余 5 项 SANDBOX-BLOCKED 需在沙箱外重跑确认，
> 根因是 agent 沙箱内 git 无法创建含 `/` 的 `task/<id>` 引用（见 issues/08），非代码缺陷。
>
> 08 是 agent 沙箱伪影，沙箱外 `git worktree add -b task/<id>` 与 M1 E2E（18/18）都正常。
> 见 [issues/08](issues/08-slashed-ref-creation-failure.md)。

**跑 04 的 SANDBOX-BLOCKED 项之前先确认沙箱状态**：这些场景需要建 `task/<id>` worktree，
在 agent 沙箱内会静默失败 / 报 `fatal: invalid reference`。
用 `.scratch/m2-implementation/repro-08.mjs` 探一下，或确保命令跑在沙箱外。

01 已完成；验证与审查记录见 [validation-01.md](validation-01.md)。
02 已完成；验证与审查记录见 [validation-02.md](validation-02.md)。

## Parallelism

After 01 + 02 complete:
- ~~03~~ completed
- ~~05~~ completed
- ~~03 + 05 parallel~~ done
- After ~~03~~ completed: 04 in-progress (6 PASS / 5 SANDBOX-BLOCKED / 0 NOT RUN)
- After ~~05~~ completed: ~~06~~ completed
- After ~~05 + 06~~ completed: ~~07~~ completed

## Source

Derived from:
- `.scratch/m0-m1-implementation-readiness-spike/m1-slice-boundary.md` — deferred-M2 table
- `docs/testing/release-gates.md` — Gate 2 (持久化与恢复) and Gate 3 (Requirement Delivery Workflow)
- M1 codebase placeholders: `packages/agent-manager`, `packages/runtime-codex`, `packages/workflow`
