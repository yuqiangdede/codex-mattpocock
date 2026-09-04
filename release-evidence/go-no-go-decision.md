# M0–M1 Implementation Readiness Spike — Go/No-Go Decision

**Decision Date:** 2026-09-04  
**Spike Scope:** M0 Protocol & Provider Spike + M1 Storage & Packaging Spike  
**Decision:** **GO** — All stop conditions cleared, M1 product implementation may begin.

---

## Validation Summary

| Ticket | Name | Result | Evidence |
|--------|------|--------|----------|
| T-001 | Project Scaffold | PASS | pnpm workspaces, tsc --build, electron-vite build |
| T-002 | Codex Binary Pin | PASS | release-evidence/runtime-manifest.json (v0.153.2, SHA256 verified) |
| T-003 | Protocol Handshake & Schema | PASS | release-evidence/schema-hash.txt, protocol-trace/initialize-trace.jsonl |
| T-004 | Thread Lifecycle | PASS | protocol-trace/thread-lifecycle-trace.jsonl |
| T-005 | Turn Control | PASS | protocol-trace/turn-control-trace.jsonl |
| T-006 | Approval Mechanism | PASS | protocol-trace/approval-mechanism-trace.jsonl |
| T-007 | Reviewer Subagent | PASS | protocol-trace/reviewer-subagent-trace.jsonl |
| T-008 | Disconnect No-Replay | PASS | failure-injection/disconnect-no-replay-trace.jsonl |
| T-009 | Provider Probe | PASS | release-evidence/provider-probe-report.json |
| T-010 | Probe Invalidation | PASS | release-evidence/provider-probe-report.json (invalidationTests) |
| T-011 | Packaged SQLite | PASS | release-evidence/sqlite-packaged-test.json (8/8 tests) |
| T-012 | Secret Isolation | PASS | release-evidence/secret-isolation-report.json (8/8 checks) |
| T-013 | Minimal Build | PASS | release-evidence/build-manifest.json (NSIS + Portable) |
| T-014 | Data Isolation | PASS | release-evidence/build-manifest.json (dataIsolationTest) |
| T-015 | Verify Script Integration | PASS | scripts/verify.ps1 --gate spike (12/12 PASS) |

**Total: 15/15 PASS, 0 FAIL**

---

## Stop Condition Assessment

| # | Stop Condition | User Story | Triggered? | Details |
|---|---------------|------------|-------------|---------|
| 1 | Protocol Drift | US-29 | **NO** | Schema Hash computed (8424cf18...). No experimental API in baseline. Stable API surface confirmed via JSONL traces. |
| 2 | Tool/Streaming Missing | US-30 | **NO** | Provider supports Chat Completions API with SSE Streaming (105 chunks) and Tool Calling (get_weather returned). Responses API not available but Chat Completions fallback works. |
| 3 | Credential Leak | US-31 | **NO** | Sentinel token not found in Renderer env, Project Shell env, log files, or diagnostic packages. Utility Process uses explicit allowlist env. |
| 4 | Packaged SQLite Unavailable | US-32 | **NO** | node:sqlite DatabaseSync works in Electron 35.7.5 Utility Process (Node 22.16.0). All 8 SQLite tests pass: WAL, synchronous=FULL, foreign_keys=ON, trusted_schema=OFF, transaction rollback, cascade delete, concurrent read, busy timeout. |
| 5 | Disconnect Input Uncertain | US-33 | **NO** | SIGKILL of App Server produces zero turn/started notifications (no auto-replay). thread/resume fails on empty rollout (expected). Architecture finding: Agent Manager must maintain own Event Store. |

**All 5 stop conditions: NOT TRIGGERED**

---

## Key Technical Findings

### 1. Electron Version Requirement
- Electron 33/34 embeds Node.js 20.x which does **NOT** support `node:sqlite`
- Electron 35+ embeds Node.js 22.x which includes experimental `node:sqlite`
- **Decision:** Electron upgraded from 33.4.11 → 35.7.5

### 2. Provider API Compatibility
- Provider (qnaigc.com) does NOT support OpenAI Responses API (`/v1/responses` → 404)
- Provider DOES support Chat Completions API (`/v1/chat/completions` → 200)
- SSE Streaming and Tool Calling both work on Chat Completions endpoint
- **Decision:** Probe script uses dual-endpoint fallback (Responses → Chat Completions)

### 3. App Server Recovery Architecture
- Codex App Server cannot recover Threads if rollout file is empty
- `thread/resume` fails with "rollout is empty" after process kill
- **Decision:** Agent Manager must maintain its own Event Store for crash recovery, cannot rely on App Server rollout

### 4. UserInput Format
- Turn control uses `{type:"text", text:"...", text_elements:[]}` format
- NOT the `{type:"message", role:"user", content:[...]}` format
- **Decision:** Implementation must use the correct UserInput schema

### 5. Build Toolchain
- winCodeSign cache requires manual extraction on Windows (macOS symlinks fail without admin)
- NSIS binary download requires mirror (GitHub direct blocked)
- electron-builder `signing` field is invalid in v25 (removed from config)
- **Decision:** Use `CSC_IDENTITY_AUTO_DISCOVERY=false` for unsigned builds

---

## M1 Prerequisites Confirmed

- [x] Codex App Server protocol verified (initialize, thread, turn, approval, review)
- [x] Schema Hash recorded for drift detection
- [x] Provider compatibility confirmed (Streaming + Tool Calling)
- [x] Packaged SQLite validated (WAL, transactions, foreign keys, concurrency)
- [x] Secret isolation verified (Renderer, Shell, logs, diagnostics all clean)
- [x] NSIS Installer and Portable EXE buildable
- [x] Data directory isolation confirmed
- [x] Integrated verify script passes all gates

---

## Conclusion

**GO** — The M0–M1 Implementation Readiness Spike has successfully validated all platform prerequisites. All 15 tickets passed, all 5 stop conditions are cleared. The project may proceed to M1 Single Task Vertical Slice implementation.

No ADR or Spec updates are required for Go. The technical findings above should be incorporated into the M1 implementation plan.

---

*This document does not contain any secrets, API keys, or credentials.*
