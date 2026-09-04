/**
 * @workbench/shared
 *
 * Shared types, constants, and utilities used across all packages.
 * This package has no dependencies on other workbench packages.
 */

/** Stable short ID prefix for tasks */
export const TASK_ID_PREFIX = "task";

/** Envelope for Main <-> Agent Manager communication */
export interface Envelope<T> {
  protocolVersion: number;
  messageId: string;
  requestId?: string;
  sentAt: string;
  kind: string;
  payload: T;
}

/** Task lifecycle states */
export type TaskLifecycle = "OPEN" | "COMPLETED" | "ARCHIVED";

/** Task execution states */
export type TaskExecution =
  | "IDLE"
  | "QUEUED"
  | "RUNNING"
  | "INTERRUPTED"
  | "FAILED"
  | "RECOVERING";

/** Task attention states */
export type TaskAttention =
  | "NONE"
  | "USER_INPUT"
  | "APPROVAL"
  | "REVIEW"
  | "STALE"
  | "UNCERTAIN";
