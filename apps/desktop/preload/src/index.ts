/**
 * Preload script — runs in an isolated context with access to a limited
 * subset of Node APIs. Exposes a typed, whitelisted API to the Renderer
 * via contextBridge.
 *
 * Security: contextIsolation=true, sandbox=true, nodeIntegration=false.
 * Only explicitly whitelisted methods are exposed.
 */

import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@workbench/shared";
import type {
  Project,
  ProjectScanResult,
  Task,
  NormalizedEvent,
  DiffResult,
  VerificationResult,
  ApprovalRequest,
  IpcResult,
} from "@workbench/shared";

const api = {
  version: "0.1.0-m1",

  // Project
  scanProject: (dirPath: string): Promise<IpcResult<Project>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_SCAN, dirPath),

  listProjects: (): Promise<IpcResult<Project[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_LIST),

  // Task
  createTask: (projectId: string, prompt: string): Promise<IpcResult<Task>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_CREATE, projectId, prompt),

  listTasks: (projectId?: string): Promise<IpcResult<Task[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST, projectId),

  getTask: (taskId: string): Promise<IpcResult<Task>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_GET, taskId),

  // Worktree
  createWorktree: (taskId: string): Promise<IpcResult<{ path: string; branch: string }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKTREE_CREATE, taskId),

  // Turn
  startTurn: (taskId: string): Promise<IpcResult<{ turnId: string }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TURN_START, taskId),

  // Approval
  onApprovalRequest: (callback: (req: ApprovalRequest) => void): void => {
    ipcRenderer.on(IPC_CHANNELS.APPROVAL_REQUEST, (_event, req: ApprovalRequest) => {
      callback(req);
    });
  },

  decideApproval: (approvalId: string, decision: "approved" | "denied"): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.APPROVAL_DECIDE, approvalId, decision),

  // Diff
  getDiff: (taskId: string): Promise<IpcResult<DiffResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.DIFF_GET, taskId),

  // Verification
  runVerification: (taskId: string): Promise<IpcResult<VerificationResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.VERIFY_RUN, taskId),

  // Recovery
  loadRecovery: (): Promise<IpcResult<{ tasks: Task[]; events: NormalizedEvent[] }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.RECOVERY_LOAD),

  // Event stream (real-time updates)
  onEventStream: (callback: (event: NormalizedEvent) => void): void => {
    ipcRenderer.on(IPC_CHANNELS.EVENT_STREAM, (_event, evt: NormalizedEvent) => {
      callback(evt);
    });
  },
} as const;

export type PreloadAPI = typeof api;

contextBridge.exposeInMainWorld("workbench", api);
