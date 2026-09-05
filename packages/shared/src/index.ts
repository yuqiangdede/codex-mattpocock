/**
 * @workbench/shared
 * Shared types, constants, and utilities used across all packages.
 */

// ================================================================
// Project
// ================================================================

export interface Project {
  id: string;
  name: string;
  path: string;
  toolchain: string[];
  createdAt: string;
}

export interface ProjectScanResult {
  path: string;
  name: string;
  toolchain: string[];
  hasGit: boolean;
  hasPackageJson: boolean;
  hasTsConfig: boolean;
}

// ================================================================
// Task
// ================================================================

export type TaskLifecycle = "OPEN" | "COMPLETED" | "ARCHIVED";
export type ExecutionState = "IDLE" | "QUEUED" | "RUNNING" | "INTERRUPTED" | "FAILED" | "RECOVERING";
export type AttentionState = "NONE" | "USER_INPUT" | "APPROVAL" | "REVIEW" | "STALE" | "UNCERTAIN";

export interface Task {
  id: string;
  projectId: string;
  prompt: string;
  lifecycle: TaskLifecycle;
  executionState: ExecutionState;
  attentionState: AttentionState;
  worktreePath: string | null;
  worktreeBranch: string | null;
  createdAt: string;
}

// ================================================================
// Events (Normalized Event Store)
// ================================================================

export type EventType =
  | "ProjectScanned"
  | "TaskCreated"
  | "WorktreeCreated"
  | "RuntimeSessionOpened"
  | "RuntimeSessionResumed"
  | "TurnStarted"
  | "AgentMessageDelta"
  | "ToolStarted"
  | "ToolCompleted"
  | "ApprovalRequested"
  | "ApprovalDecided"
  | "TurnSteered"
  | "TurnCompleted"
  | "TurnInterrupted"
  | "VerificationCompleted";

export interface NormalizedEvent {
  id: string;
  type: EventType;
  taskId: string | null;
  turnId: string | null;
  payload: Record<string, unknown>;
  timestamp: string;
}

// ================================================================
// Projections
// ================================================================

export interface TaskProjection {
  taskId: string;
  status: string;
  timelineSummary: string[];
  lastEventAt: string;
}

// ================================================================
// Approval
// ================================================================

export type ApprovalType = "command" | "file" | "network" | "mcp";
export type ApprovalDecision = "approved" | "denied";

export interface ApprovalRequest {
  id: string;
  taskId: string;
  turnId: string;
  type: ApprovalType;
  target: string;
  summary: string;
  /** Codex App Server 服务端请求的 JSON-RPC id；用于决策回写路由。 */
  serverRequestId?: number;
  /** 服务端请求方法名（exec / patch / ...），便于 Renderer 区分语义。 */
  serverMethod?: string;
}

// ================================================================
// Diff & Verification
// ================================================================

export interface DiffResult {
  taskId: string;
  files: DiffFile[];
  summary: string;
}

export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  patch: string;
}

export interface VerificationResult {
  taskId: string;
  exitCode: number;
  output: string;
  passed: boolean;
}

// ================================================================
// IPC Channel Definitions
// ================================================================

export const IPC_CHANNELS = {
  PROJECT_SCAN: "project:scan",
  PROJECT_LIST: "project:list",
  TASK_CREATE: "task:create",
  TASK_LIST: "task:list",
  TASK_GET: "task:get",
  WORKTREE_CREATE: "worktree:create",
  TURN_START: "turn:start",
  TURN_STEER: "turn:steer",
  TURN_INTERRUPT: "turn:interrupt",
  APPROVAL_REQUEST: "approval:request",
  APPROVAL_DECIDE: "approval:decide",
  DIFF_GET: "diff:get",
  VERIFY_RUN: "verify:run",
  RECOVERY_LOAD: "recovery:load",
  EVENT_STREAM: "event:stream",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

// ================================================================
// Result type for IPC responses
// ================================================================

export interface IpcResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

export function err<T>(error: string): IpcResult<T> {
  return { ok: false, error };
}

// ================================================================
// Utility: generate IDs
// ================================================================

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export * from './manager-protocol.js';
