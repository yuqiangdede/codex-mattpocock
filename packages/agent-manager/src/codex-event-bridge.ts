/**
 * Codex App Server 事件 → NormalizedEvent 桥接。
 *
 * 职责边界：只做协议事件到领域事件的翻译，不直接持有数据库或 Runtime。
 * Agent Manager 负责把翻译结果落盘与转发。
 */

import type { ServerNotification } from "@workbench/protocol";
import type {
  ApprovalRequest,
  ApprovalType,
  NormalizedEvent,
} from "@workbench/shared";
import type {
  ExecutionState,
  AttentionState,
  EventType,
} from "@workbench/shared";

export interface CodexEventMapping {
  /** 落到事件流的归一化事件；缺省即本通知不产生事件（如状态变化但 Timeline 不必累加）。 */
  event?: NormalizedEvent;
  /** 若产生事件，伴随的任务状态变更；写入 events 与 tasks 同一事务。 */
  taskState?: { executionState: ExecutionState; attentionState: AttentionState };
  /** 触发 Renderer 审批对话框；Agent Manager 据此写入 pendingApprovals 并通过 APPROVAL_REQUEST 通道推送。 */
  approval?: Omit<ApprovalRequest, "id">;
  /** 服务端审批请求 ID，由 Agent Manager 写入 ApprovalRequest.serverRequestId。 */
  serverRequestId?: number;
}

/** 把 Codex 服务端通知翻译成归一化事件，缺省返回 null（未知或忽略）。 */
export function mapCodexNotification(
  notification: ServerNotification,
  ctx: { taskId: string; turnId: string | null; generateId: (prefix: string) => string },
): CodexEventMapping | null {
  const timestamp = new Date().toISOString();
  switch (notification.method) {
    case 'item/started':
    case 'item/completed': {
      const params = notification.params as { item: { id: string; type: string; aggregatedOutput?: string }; turnId: string };
      if (params.item.type !== 'commandExecution') return null;
      const type = notification.method === 'item/started' ? 'ToolStarted' : 'ToolCompleted';
      return { event: { id: `${ctx.taskId}:${params.turnId}:${params.item.id}:${type}`,
        type, taskId: ctx.taskId, turnId: params.turnId, timestamp,
        payload: { itemId: params.item.id, output: params.item.aggregatedOutput ?? '' } } };
    }
    case "thread/started": {
      const thread = (notification.params as { thread: { id: string; preview?: string; modelProvider: string; model: string; cwd: string } }).thread;
      return {
        event: makeEvent("RuntimeSessionOpened", ctx, timestamp, {
          threadId: thread.id,
          modelProvider: thread.modelProvider,
          model: thread.model,
          cwd: thread.cwd,
          preview: thread.preview ?? "",
        }),
      };
    }
    case "turn/started": {
      const turn = (notification.params as { turn: { id: string } }).turn;
      return {
        event: { ...makeEvent("TurnStarted", ctx, timestamp, { turnId: turn.id }), id: `${ctx.taskId}:${turn.id}:started`, turnId: turn.id },
        taskState: { executionState: "RUNNING", attentionState: "NONE" },
      };
    }
    case "turn/completed": {
      const turn = (notification.params as { turn: { id: string; status: string; error?: unknown } }).turn;
      const failed = turn.status === "failed";
      return {
        event: { ...makeEvent("TurnCompleted", ctx, timestamp, {
          turnId: turn.id,
          status: turn.status,
          error: turn.error ?? null,
        }), id: `${ctx.taskId}:${turn.id}:completed`, turnId: turn.id },
        taskState: failed
          ? { executionState: "FAILED", attentionState: "REVIEW" }
          : { executionState: "IDLE", attentionState: "NONE" },
      };
    }
    case "thread/status/changed": {
      const status = (notification.params as { status: { type: string; activeFlags?: string[] } }).status;
      // 状态变化已在 Turn 生命周期事件里覆盖；此处仅作可观测性。
      return {
        event: makeEvent("TurnStarted", ctx, timestamp, {
          kind: "thread-status",
          status: status.type,
          activeFlags: status.activeFlags ?? [],
        }),
      };
    }
    case "warning": {
      const params = notification.params as { threadId?: string; message: string };
      return {
        event: makeEvent("TurnStarted", ctx, timestamp, {
          kind: "warning",
          message: params.message,
          threadId: params.threadId ?? null,
        }),
      };
    }
    default:
      return null;
  }
}

/** 把 Codex 服务端审批请求翻译成 Agent Manager 内部待办记录。 */
export function mapApprovalRequest(
  request: { id: number; method: string; params: Record<string, unknown> },
  ctx: { taskId: string; turnId: string },
): { approval: Omit<ApprovalRequest, "id">; serverRequestId: number } {
  const approval = mapApprovalParams(request.method, request.params, ctx);
  return { approval, serverRequestId: request.id };
}

function mapApprovalParams(
  method: string,
  params: Record<string, unknown>,
  ctx: { taskId: string; turnId: string },
): Omit<ApprovalRequest, "id"> {
  const base: Omit<ApprovalRequest, "id"> = {
    taskId: ctx.taskId,
    turnId: ctx.turnId,
    type: approvalTypeForMethod(method),
    target: "",
    summary: "",
    serverMethod: method,
  };
  switch (method) {
    case "item/commandExecution/requestApproval": {
      const command = typeof params.command === "string" ? params.command : "";
      const cwd = typeof params.cwd === "string" ? params.cwd : "";
      return {
        ...base,
        target: command,
        summary: cwd ? `在 ${cwd} 执行：${command}` : `执行命令：${command}`,
      };
    }
    case "item/fileChange/requestApproval": {
      const grantRoot = typeof params.grantRoot === "string" ? params.grantRoot : "";
      const reason = typeof params.reason === "string" ? params.reason : "";
      return {
        ...base,
        target: grantRoot,
        summary: reason ? `修改文件：${reason}` : "修改文件",
      };
    }
    case "item/permissions/requestApproval": {
      const reason = typeof params.reason === "string" ? params.reason : "";
      return {
        ...base,
        target: "permissions",
        summary: reason || "权限变更请求",
      };
    }
    default:
      return { ...base, target: method, summary: "未识别的审批请求" };
  }
}

function approvalTypeForMethod(method: string): ApprovalType {
  if (method === "item/commandExecution/requestApproval") return "command";
  if (method === "item/fileChange/requestApproval") return "file";
  return "mcp";
}

function makeEvent(
  type: EventType,
  ctx: { taskId: string; turnId: string | null; generateId: (prefix: string) => string },
  timestamp: string,
  payload: Record<string, unknown>,
): NormalizedEvent {
  return {
    id: ctx.generateId("evt"),
    type,
    taskId: ctx.taskId,
    turnId: ctx.turnId,
    payload,
    timestamp,
  };
}
