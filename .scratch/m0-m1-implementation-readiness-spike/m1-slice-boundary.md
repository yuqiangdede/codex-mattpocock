# M1 Single-Task Vertical Slice Boundary

**Created:** 2026-09-04  
**Based on:** M0 Spike Go Decision (release-evidence/go-no-go-decision.md)  
**Status:** Ready for M1 implementation

---

## Slice Path

The M1 vertical slice covers the following end-to-end flow:

```
Project Scan → Task Creation → Integration Worktree → Turn Execution → Approval → Diff → Verification → Renderer Reload Recovery
```

Each step is the minimal observable path from project initialization to recovery after reload.

---

## Step Definitions

### 1. Project Scan
- **Action:** User selects a local project directory. Workbench scans for package.json/tsconfig.json/git repo.
- **Minimal UI:** Project selector in left sidebar; shows project name, path, and detected toolchain.
- **Persisted Event:** `ProjectScanned` (projectPath, toolchain, timestamp)
- **Fixture:** A simple TypeScript/npm project with one `index.ts` and one `index.test.ts`.
- **Gate Evidence:** Event Trace entry with project metadata.

### 2. Task Creation
- **Action:** User creates a Task with a text prompt (e.g., "Add a hello() function to index.ts").
- **Minimal UI:** Task card in left sidebar; Composer input in center panel.
- **Persisted Event:** `TaskCreated` (taskId, prompt, projectId, timestamp)
- **Fixture:** Prompt = "Add a hello() function that returns 'hello world'".
- **Gate Evidence:** Event Trace entry with taskId and prompt.

### 3. Integration Worktree
- **Action:** Workbench creates a git worktree for the task (branch: `task/<taskId>`).
- **Minimal UI:** Status indicator on Task card showing "worktree ready".
- **Persisted Event:** `WorktreeCreated` (taskId, branch, worktreePath)
- **Fixture:** Worktree created from main branch of the fixture project.
- **Gate Evidence:** Git worktree list output showing the task branch.

### 4. Turn Execution
- **Action:** Workbench starts a Turn via Codex App Server `turn/start` with the task prompt.
- **Minimal UI:** Timeline panel shows Turn started, streaming output appears.
- **Persisted Event:** `TurnStarted` (turnId, taskId, prompt, timestamp)
- **Fixture:** Codex generates `hello()` function and writes to worktree.
- **Gate Evidence:** JSONL trace of `turn/start` → `turn/started` notification.

### 5. Approval
- **Action:** Codex requests Approval for a file write (Command or File approval).
- **Minimal UI:** Approval panel appears in right sidebar with "Approve"/"Deny" buttons.
- **Persisted Event:** `ApprovalRequested` (approvalType, target, turnId) → `ApprovalDecided` (decision, timestamp)
- **Fixture:** Approval for writing `index.ts` in worktree.
- **Gate Evidence:** JSONL trace of approval request and decision response.

### 6. Diff
- **Action:** After Turn completes, Workbench shows git diff of changes in worktree.
- **Minimal UI:** Diff panel in right sidebar showing added/modified lines.
- **Persisted Event:** `TurnCompleted` (turnId, status, diffSummary)
- **Fixture:** Diff shows `hello()` function added to `index.ts`.
- **Gate Evidence:** `git diff` output in worktree.

### 7. Verification
- **Action:** Workbench runs `npm test` in the worktree and captures results.
- **Minimal UI:** Verification status badge on Task card (pass/fail); test output in timeline.
- **Persisted Event:** `VerificationCompleted` (taskId, exitCode, output)
- **Fixture:** `npm test` passes (hello() returns 'hello world').
- **Gate Evidence:** Test runner output with exit code 0.

### 8. Renderer Reload Recovery
- **Action:** User reloads the Electron app. Workbench restores Task state from persisted events.
- **Minimal UI:** After reload, left sidebar shows the same Task with correct status; timeline shows all events.
- **Persisted Event:** Recovery reads all events for the Task from SQLite and reconstructs UI state.
- **Fixture:** After reload, Task card shows "verification passed", timeline shows all 7 prior events.
- **Gate Evidence:** Task ID before reload == Task ID after reload; event count matches.

---

## Minimal UI Layout

```
┌─────────────────┬──────────────────────────┬─────────────────────┐
│ Left Sidebar    │ Center Panel             │ Right Sidebar      │
│                 │                          │                     │
│ Project List    │ Timeline (events)        │ Context Panel      │
│  └ Project A    │  ├ Turn started          │  (project info)    │
│                 │  ├ Approval requested    │                     │
│ Task List       │  ├ Turn completed        │ Artifact Panel     │
│  └ Task #1     │  └ Verification done     │  (diff, files)     │
│    [PASS]       │                          │                     │
│                 │ Composer (input)         │ Approval Panel     │
│                 │  ┌──────────────────┐    │  (approve/deny)    │
│                 │  │ Type message... │    │                     │
│                 │  └──────────────────┘    │ Diff Panel         │
│                 │                          │  (git diff)        │
└─────────────────┴──────────────────────────┴─────────────────────┘
```

---

## Persisted Event Schema

All events are written to SQLite in a single transaction with:

1. **Normalized Event** — canonical event record (type, payload, timestamp, taskId, turnId)
2. **Projection** — materialized view for fast UI queries (task status, timeline summary)
3. **Attention Outbox** — pending UI notifications to deliver after reload

```
BEGIN TRANSACTION;
  INSERT INTO events (type, payload, task_id, turn_id, timestamp) VALUES (...);
  INSERT INTO projections (task_id, view_type, view_data) VALUES (...);
  INSERT INTO attention_outbox (task_id, event_id, delivered) VALUES (...);
COMMIT;
```

---

## Deferred to M2/M3

The following capabilities are explicitly **NOT** in M1:

| Capability | Deferred To | Reason |
|-----------|------------|--------|
| Full recovery coordination | M2 | M1 only tests single-task reload; multi-task recovery needs event ordering |
| Fault injection matrix | M2 | M1 verifies happy path only; fault injection needs systematic test harness |
| Ticket DAG scheduling | M2 | M1 is single-task; DAG needs multi-task dependency resolution |
| Child Task parallelism | M3 | M1 has no child tasks; parallelism needs resource management |
| Independent Final Review | M2 | M1 has no Reviewer Subagent; needs protocol integration from T-007 |
| Integration Preflight | M2 | M1 has no integration branch; needs multi-worktree merge logic |
| Code signing | M5 | Per release-gates.md; M1 builds are unsigned |
| Auto-update | M5 | Per release-gates.md; M1 has no update channel |

---

## Gate 1 Alignment

Per `release-gates.md`, Gate 1 (Spike) requires:
- [x] Protocol traces exist and are sanitized
- [x] Schema Hash recorded
- [x] Provider Probe passed
- [x] SQLite Packaged test passed
- [x] Secret isolation verified
- [x] Build artifacts generated
- [x] Go/No-Go decision recorded

M1 slice boundary is consistent with Gate 1 exit criteria: all Spike evidence is in `release-evidence/` and the verify script passes.
