/**
 * stdio JSONL 上的 JSON-RPC 2.0 连接。
 *
 * Codex App Server 只用默认 stdio JSONL 双向 JSON-RPC（`api-boundary.md`：
 * WebSocket 与 Unix socket 属实验性，不进入 MVP 基线）。
 *
 * 职责边界：只做组帧、请求/响应关联、通知与服务端请求的路由。
 * 不理解任何业务语义，也不决定重试策略。
 */

import type {
  JsonRpcError,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from "@workbench/protocol";

export type NotificationHandler = (method: string, params: unknown) => void;

/**
 * 服务端主动请求的处理器。返回值作为 result 回写；抛错则回写 error。
 * Approval 请求会长时间挂起等用户决策，因此这里必须是 Promise。
 */
export type ServerRequestHandler = (
  id: number,
  method: string,
  params: unknown,
) => Promise<unknown>;

export interface JsonRpcConnectionOptions {
  /** 写入一条完整报文（含换行）。 */
  write: (line: string) => void;
  /** 连接断开时拒绝所有在途请求的原因。 */
  close: () => void;
  onNotification: NotificationHandler;
  /** 未提供时，服务端主动请求一律回 method not found。 */
  onServerRequest?: ServerRequestHandler;
  /** 非 JSON 或畸形报文；默认丢弃。 */
  onMalformed?: (line: string, error: unknown) => void;
}

interface PendingRequest {
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: Error) => void;
}

export class JsonRpcConnection {
  private nextId = 1;
  private buffer = "";
  private closed = false;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly options: JsonRpcConnectionOptions) {}

  /** 收到子进程 stdout 的一个数据块。按行切分，保留不完整的尾行。 */
  receive(chunk: string): void {
    if (this.closed) return;
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse & { method?: string; params?: unknown };
    try {
      message = JSON.parse(line) as typeof message;
    } catch (error) {
      this.options.onMalformed?.(line, error);
      return;
    }
    if (!message || typeof message !== "object") {
      this.options.onMalformed?.(line, new Error("报文不是对象"));
      return;
    }

    // 服务端主动请求：有 id 且有 method。
    if (typeof message.method === "string" && message.id !== undefined) {
      void this.answerServerRequest(message.id, message.method, message.params);
      return;
    }

    // 服务端主动通知：有 method 但无 id。
    if (typeof message.method === "string") {
      this.options.onNotification(message.method, message.params);
      return;
    }

    // 对我方请求的响应。
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      pending.resolve(message as JsonRpcResponse);
    }
  }

  private async answerServerRequest(
    id: number,
    method: string,
    params: unknown,
  ): Promise<void> {
    const handler = this.options.onServerRequest;
    if (!handler) {
      this.writeResponse(id, undefined, {
        code: -32601,
        message: `不支持的服务端请求：${method}`,
      });
      return;
    }
    try {
      this.writeResponse(id, await handler(id, method, params), undefined);
    } catch (error) {
      this.writeResponse(id, undefined, {
        code: -32603,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private writeResponse(
    id: number,
    result: unknown,
    error: JsonRpcError | undefined,
  ): void {
    if (this.closed) return;
    // result 为 undefined 且无 error 时仍要序列化 result 键，避免对端判定为空响应。
    const payload: JsonRpcResponse = error
      ? { id, error }
      : { id, result: result ?? null };
    this.options.write(`${JSON.stringify(payload)}\n`);
  }

  request<P>(method: string, params: P): Promise<JsonRpcResponse> {
    if (this.closed) return Promise.reject(new Error("Codex App Server 连接已关闭"));
    const id = this.nextId++;
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const message: JsonRpcRequest<P> = { id, method, params };
      try {
        this.options.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify<P>(method: string, params: P): void {
    if (this.closed) return;
    const message: JsonRpcNotification<P> = { method, params };
    this.options.write(`${JSON.stringify(message)}\n`);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** 连接断开：在途请求一律失败，不做静默悬挂。 */
  fail(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    const error = new Error(reason);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  /** 正常关闭：不再接受新请求，但不打断已完成的响应回写。 */
  dispose(): void {
    this.closed = true;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** 供 close() 使用，测试可断言在途请求数归零。 */
  requestClose(): void {
    this.options.close();
  }
}
