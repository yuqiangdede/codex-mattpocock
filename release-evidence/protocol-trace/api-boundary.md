# Codex App Server API Boundary — Stable vs Experimental

**Codex Version**: 0.153.2  
**Schema Hash**: 8424cf18d0835afb853096ca334033018c3f6663a50dc3a3ee518c83de04ca16  
**Generated**: 2026-09-04

## Transport

| Transport | Status | MVP Baseline |
|---|---|---|
| stdio JSONL (`--listen stdio://`, default) | Stable | ✅ Used |
| WebSocket (`--listen ws://IP:PORT`) | Experimental | ❌ Excluded |
| Unix socket (`--listen unix://`) | Experimental | ❌ Excluded |
| Off (`--listen off`) | Stable | N/A |

## Stable API Methods (MVP Baseline)

These methods are part of the stable JSON-RPC 2.0 protocol and are included in the MVP baseline.

### Initialization

| Method | Type | Description |
|---|---|---|
| `initialize` | Request | Client handshake with clientInfo metadata |
| `initialized` | Notification | Acknowledge initialization completion |

### Thread Lifecycle

| Method | Type | Description |
|---|---|---|
| `thread/start` | Request | Create a new conversation thread |
| `thread/resume` | Request | Resume an existing thread by ID |
| `thread/fork` | Request | Fork an existing thread into a new ID |
| `thread/list` | Request | Page through stored threads |
| `thread/read` | Request | Read a thread by ID without resuming |
| `thread/archive` | Request | Archive a thread |
| `thread/unarchive` | Request | Restore an archived thread |
| `thread/name/set` | Request | Set or update a thread's name |
| `thread/compact/start` | Request | Trigger conversation history compaction |
| `thread/loaded/list` | Request | List thread IDs currently in memory |

### Turn Control

| Method | Type | Description |
|---|---|---|
| `turn/start` | Request | Send user input and begin a turn |
| `turn/steer` | Request | Steer an active turn mid-execution |
| `turn/interrupt` | Request | Interrupt an active turn |

### Review

| Method | Type | Description |
|---|---|---|
| `review/start` | Request | Start a reviewer subagent |

### Approvals

| Method | Type | Description |
|---|---|---|
| `execCommandApproval` | Request | Approve/deny a command execution |
| `applyPatchApproval` | Request | Approve/deny a file patch |
| `networkPolicyAmendment` | Request | Amend network policy |
| `execPolicyAmendment` | Request | Amend execution policy |

### Auth

| Method | Type | Description |
|---|---|---|
| `getAuthStatus` | Request | Check authentication status |
| `chatgptAuthTokensRefresh` | Request | Refresh ChatGPT auth tokens |
| `forcedLogin` | Request | Force login flow |

### Fuzzy File Search

| Method | Type | Description |
|---|---|---|
| `fuzzyFileSearch` | Request | Perform fuzzy file search |

### Git

| Method | Type | Description |
|---|---|---|
| `gitDiffToRemote` | Request | Get git diff to remote |

### Conversation Summary

| Method | Type | Description |
|---|---|---|
| `getConversationSummary` | Request | Get conversation summary |

## Experimental APIs (Excluded from MVP)

These APIs are explicitly **excluded** from the MVP baseline per ADR-0003 and the Spec.

| API / Feature | Reason for Exclusion |
|---|---|
| WebSocket transport (`--listen ws://`) | Experimental, unsupported for production |
| Unix socket transport (`--listen unix://`) | Not applicable on Windows |
| `process/*` methods | Process management not in MVP scope |
| Dynamic tools (runtime tool registration) | Not in MVP scope; tools are static |
| Paginated history (`historyMode: "paginated"`) | MVP uses simple thread/resume, not pagination |
| Realtime voice / audio | Not in MVP scope |
| Multi-agent mode | Not in MVP scope |
| Attestation generation | Not in MVP scope |
| Remote control / code-mode-host | Not in MVP scope |
| Image generation | Not in MVP scope |

## Server-Initiated Notifications (Stable)

Notifications the server sends to the client (no `id` field):

| Notification | Description |
|---|---|
| `thread/started` | Thread created or resumed |
| `turn/started` | Turn has started |
| `turn/completed` | Turn has completed |
| `item/started` | Item processing started |
| `item/completed` | Item processing completed |
| `item/agentMessage/delta` | Streaming agent message delta |
| `remoteControl/status/changed` | Remote control status changed |

## Protocol Constraints

1. **JSON-RPC 2.0** with `"jsonrpc":"2.0"` header omitted on wire.
2. **stdio only**: newline-delimited JSON (JSONL) over stdin/stdout.
3. **Initialize-first**: any request before `initialize` is rejected.
4. **Single initialize**: repeated `initialize` calls return "Already initialized" error.
5. **Backpressure**: when server is overloaded, returns JSON-RPC error -32001 "Server overloaded; retry later."
