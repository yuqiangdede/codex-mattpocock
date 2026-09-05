# M2 Implementation — Ticket DAG

## Tickets

| # | Title | Blocked by | Status |
|---|-------|-------------|--------|
| 01 | Agent Manager 进程化与 Event Store 接管 | — | completed |
| 02 | Codex Runtime Session 生命周期管理 | 01 | completed |
| 03 | 持久化恢复协调 | 01 | ready-for-agent |
| 04 | 故障注入验证矩阵 | 03 | ready-for-agent |
| 05 | Ticket DAG 调度与 Child Task | 02 | ready-for-agent |
| 06 | Independent Final Review | 02, 05 | ready-for-agent |
| 07 | Integration Preflight | 05, 06 | ready-for-agent |

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

- **03** — 持久化恢复协调
- **05** — Ticket DAG 调度与 Child Task（依赖 02 完成）

01 已完成；验证与审查记录见 [validation-01.md](validation-01.md)。
02 已完成；验证与审查记录见 [validation-02.md](validation-02.md)。

## Parallelism

After 01 + 02 complete:
- 03 can run independently
- 05 can run (depends on 02)
- 03 + 05 can run in parallel
- After 03 completes: 04 can start
- After 05 completes: 06 can start (with 02 already done)
- After 05 + 06 complete: 07 can start

## Source

Derived from:
- `.scratch/m0-m1-implementation-readiness-spike/m1-slice-boundary.md` — deferred-M2 table
- `docs/testing/release-gates.md` — Gate 2 (持久化与恢复) and Gate 3 (Requirement Delivery Workflow)
- M1 codebase placeholders: `packages/agent-manager`, `packages/runtime-codex`, `packages/workflow`
