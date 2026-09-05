/**
 * @workbench/protocol
 *
 * Codex App Server 协议的 MVP 基线类型。
 *
 * 传输层固定为 stdio JSONL 双向 JSON-RPC 2.0（线上省略 "jsonrpc" 字段）。
 * 稳定 / 实验性边界见 `release-evidence/protocol-trace/api-boundary.md`：
 * WebSocket、process/*、动态工具、分页历史均不进入 MVP 基线。
 *
 * 本文件是手写的 MVP 子集，权威定义来自固定 Binary 生成的 JSON Schema：
 * `release-evidence/protocol-trace/json-schema/`，Schema Hash 记录在
 * `release-evidence/schema-hash.txt`。
 */

export const CODEX_SCHEMA_HASH =
  "8424cf18d0835afb853096ca334033018c3f6663a50dc3a3ee518c83de04ca16";

export const CODEX_CLIENT_NAME = "coding-agent-workbench";
export const CODEX_CLIENT_TITLE = "Coding Agent Workbench";
export const CODEX_CLIENT_VERSION = "0.0.1";

// ================================================================
// JSON-RPC 2.0 over stdio JSONL
// ================================================================

/** 客户端发出的请求。 */
export interface JsonRpcRequest<P = unknown> {
  id: number;
  method: string;
  params: P;
}

/** 客户端发出的通知（无 id，不期待响应）。 */
export interface JsonRpcNotification<P = unknown> {
  method: string;
  params: P;
}

/** 服务端对客户端请求的响应。result 与 error 互斥。 */
export interface JsonRpcResponse<R = unknown> {
  id: number;
  result?: R;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** 服务端过载时的背压错误码。 */
export const CODEX_ERROR_OVERLOADED = -32001;

/** 按 JSON-RPC 语义判断一条响应是否成功。 */
export function isSuccessfulResponse(
  response: JsonRpcResponse | undefined | null,
): boolean {
  return !!response && "result" in response && !("error" in response);
}

// ================================================================
// initialize
// ================================================================

export interface ClientInfo {
  name: string;
  title: string;
  version: string;
}

export interface InitializeParams {
  clientInfo: ClientInfo;
  capabilities?: {
    experimentalApi?: boolean;
    requestAttestation?: boolean;
  };
}

export interface InitializeResult {
  userAgent: string;
}

// ================================================================
// Thread（领域术语 Runtime Session 的实现载体）
// ================================================================

export interface ThreadStartParams {
  cwd: string;
  approvalPolicy: ApprovalPolicy;
  sandbox: SandboxMode;
  serviceName?: string;
  model?: string;
  modelProvider?: string;
}

export interface ThreadResumeParams {
  threadId: string;
}

export type ApprovalPolicy = "on-request" | "on-failure" | "never" | "untrusted";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface Thread {
  id: string;
  preview: string;
  modelProvider: string;
  model: string;
  cwd: string;
  status: { type: string; activeFlags?: string[] };
  createdAt: number;
  updatedAt: number;
}

export interface ThreadStartResult {
  thread: Thread;
  model: string;
  modelProvider: string;
  approvalPolicy: ApprovalPolicy;
}

export interface ThreadResumeResult {
  thread: Thread;
  model: string;
  modelProvider: string;
}

// ================================================================
// Turn
// ================================================================

/** turn/start 与 turn/steer 的 UserInput 格式。 */
export interface UserInputText {
  type: "text";
  text: string;
  text_elements: unknown[];
}

export type UserInput = UserInputText;

export interface TurnStartParams {
  threadId: string;
  input: UserInput[];
}

export interface TurnSteerParams {
  threadId: string;
  expectedTurnId: string;
  input: UserInput[];
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export type TurnStatus = "inProgress" | "completed" | "interrupted" | "failed";

export interface Turn {
  id: string;
  status: TurnStatus;
  error: unknown;
  items: TurnItem[];
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
}

export interface TurnStartResult {
  turn: Turn;
}

// ================================================================
// Turn Item
// ================================================================

interface ItemBase {
  id: string;
  [key: string]: unknown;
}

export interface UserMessageItem extends ItemBase {
  type: "userMessage";
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
}

export interface AgentMessageItem extends ItemBase {
  type: "agentMessage";
  text: string;
}

export interface CommandExecutionItem extends ItemBase {
  type: "commandExecution";
  command: string;
  cwd: string;
  status?: string;
  exitCode?: number | null;
  aggregatedOutput?: string;
}

export interface FileChangeItem extends ItemBase {
  type: "fileChange";
  changes: Array<{ path: string; kind: string; [key: string]: unknown }>;
  status?: string;
}

export interface McpToolCallItem extends ItemBase {
  type: "mcpToolCall";
  server: string;
  tool: string;
  status?: string;
}

export interface ReasoningItem extends ItemBase {
  type: "reasoning";
  text?: string;
}

export interface WebSearchItem extends ItemBase {
  type: "webSearch";
  query?: string;
}

export interface TodoListItem extends ItemBase {
  type: "todoList";
  items?: unknown[];
}

export interface ImageViewItem extends ItemBase {
  type: "imageView";
  path?: string;
}

export interface UnknownItem extends ItemBase {
  type: string;
}

export type TurnItem =
  | UserMessageItem
  | AgentMessageItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | ReasoningItem
  | WebSearchItem
  | TodoListItem
  | ImageViewItem
  | UnknownItem;

// ================================================================
// 服务端主动通知
// ================================================================

export interface ThreadStartedNotification {
  method: "thread/started";
  params: { thread: Thread };
}

export interface TurnStartedNotification {
  method: "turn/started";
  params: { threadId: string; turn: Turn };
}

export interface TurnCompletedNotification {
  method: "turn/completed";
  params: { threadId: string; turn: Turn };
}

export interface ItemStartedNotification {
  method: "item/started";
  params: { threadId: string; turnId: string; item: TurnItem };
}

export interface ItemCompletedNotification {
  method: "item/completed";
  params: { threadId: string; turnId: string; item: TurnItem };
}

export interface AgentMessageDeltaNotification {
  method: "item/agentMessage/delta";
  params: { threadId: string; turnId: string; itemId: string; delta: string };
}

export interface ThreadStatusChangedNotification {
  method: "thread/status/changed";
  params: { threadId: string; status: { type: string; activeFlags?: string[] } };
}

export interface WarningNotification {
  method: "warning";
  params: { threadId?: string; message: string };
}

export interface RemoteControlStatusChangedNotification {
  method: "remoteControl/status/changed";
  params: { status: string; [key: string]: unknown };
}

export type ServerNotification =
  | ThreadStartedNotification
  | TurnStartedNotification
  | TurnCompletedNotification
  | ItemStartedNotification
  | ItemCompletedNotification
  | AgentMessageDeltaNotification
  | ThreadStatusChangedNotification
  | WarningNotification
  | RemoteControlStatusChangedNotification;

// ================================================================
// 服务端主动发起的 Approval 请求（我方必须回 decision）
// ================================================================

export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface CommandExecutionApprovalRequest {
  id: number;
  method: "item/commandExecution/requestApproval";
  params: {
    threadId: string;
    turnId: string;
    itemId: string;
    command: string;
    cwd: string;
    reason?: string;
    [key: string]: unknown;
  };
}

export interface FileChangeApprovalRequest {
  id: number;
  method: "item/fileChange/requestApproval";
  params: {
    threadId: string;
    turnId: string;
    itemId: string;
    reason?: string;
    grantRoot?: string;
    [key: string]: unknown;
  };
}

export interface PermissionsApprovalRequest {
  id: number;
  method: "item/permissions/requestApproval";
  params: {
    threadId: string;
    turnId: string;
    itemId: string;
    reason?: string;
    permissions?: unknown;
    [key: string]: unknown;
  };
}

export type ServerRequest =
  | CommandExecutionApprovalRequest
  | FileChangeApprovalRequest
  | PermissionsApprovalRequest;

export const APPROVAL_REQUEST_METHODS = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
] as const;

export type ApprovalRequestMethod = (typeof APPROVAL_REQUEST_METHODS)[number];

export function isApprovalRequestMethod(
  method: string,
): method is ApprovalRequestMethod {
  return (APPROVAL_REQUEST_METHODS as readonly string[]).includes(method);
}
