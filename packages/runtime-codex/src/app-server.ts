/**
 * Codex App Server 客户端：进程生命周期 + initialize 握手 + Thread/Turn 控制。
 *
 * 传输层固定 stdio JSONL（api-boundary.md：WebSocket / Unix socket 属实验性）。
 * 协议约束：initialize 必须是第一个请求；重复 initialize 会返回
 * "Already initialized" 错误；服务端过载返回 -32001。
 *
 * 领域术语（CONTEXT.md）：这里的 Codex "Thread" 是 Runtime Session 的
 * 实现载体，对外不暴露 Thread 概念。
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  ApprovalDecision,
  InitializeParams,
  InitializeResult,
  JsonRpcResponse,
  ServerNotification,
  ServerRequest,
  ThreadResumeParams,
  ThreadResumeResult,
  ThreadStartParams,
  ThreadStartResult,
  TurnInterruptParams,
  TurnStartParams,
  TurnStartResult,
  TurnSteerParams,
  UserInput,
} from "@workbench/protocol";
import {
  CODEX_CLIENT_NAME,
  CODEX_CLIENT_TITLE,
  CODEX_CLIENT_VERSION,
  isApprovalRequestMethod,
  isSuccessfulResponse,
} from "@workbench/protocol";
import { JsonRpcConnection } from "./jsonrpc.js";
import {
  buildAppServerEnv,
  writeCodexHomeConfig,
} from "./secret-helper.js";
import type { ProviderProfile } from "./provider-profile.js";

/** 便于测试替换进程创建，而不伪造协议本身。 */
export type SpawnFn = (
  binaryPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) => ChildProcessWithoutNullStreams;

export const CODEX_APP_SERVER_ARGS = ["app-server"] as const;

export interface CodexAppServerOptions {
  binaryPath: string;
  codexHome: string;
  profile: ProviderProfile;
  /** 由受控认证 Helper 提供；为 null 时仍能握手，但无法执行模型 Turn。 */
  secret: string | null;
  approvalPolicy: ThreadStartParams["approvalPolicy"];
  sandbox: ThreadStartParams["sandbox"];
  onNotification: (notification: ServerNotification) => void;
  onApprovalRequest: (request: ServerRequest) => Promise<ApprovalDecision>;
  onStderr?: (chunk: string) => void;
  spawnFn?: SpawnFn;
  /** initialize 握手超时（毫秒）。 */
  handshakeTimeoutMs?: number;
  /** 优雅退出后强杀的宽限时间（毫秒）。 */
  killGraceMs?: number;
}

export function textInput(text: string): UserInput[] {
  return [{ type: "text", text, text_elements: [] }];
}

export class CodexAppServer {
  private readonly rpc: JsonRpcConnection;
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly killGraceMs: number;
  private exitPromise: Promise<void> | null = null;
  private stopped = false;

  private constructor(
    proc: ChildProcessWithoutNullStreams,
    options: CodexAppServerOptions,
  ) {
    this.proc = proc;
    this.killGraceMs = options.killGraceMs ?? 5_000;
    this.rpc = new JsonRpcConnection({
      write: (line) => {
        if (!this.stopped) proc.stdin.write(line);
      },
      close: () => {
        proc.stdin.end();
      },
      onNotification: (method, params) => {
        options.onNotification({ method, params } as ServerNotification);
      },
      onServerRequest: async (id, method, params) => {
        if (!isApprovalRequestMethod(method)) {
          throw new Error(`不支持的服务端请求：${method}`);
        }
        const decision = await options.onApprovalRequest({
          id,
          method,
          params,
        } as ServerRequest);
        return { decision };
      },
      onMalformed: (line) => {
        // App Server 偶发输出非 JSON 的诊断行；忽略但保留可观测性。
        options.onStderr?.(`[非 JSON 输出] ${line}`);
      },
    });

    proc.stdout.on("data", (chunk: Buffer) => {
      this.rpc.receive(chunk.toString("utf8"));
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      options.onStderr?.(chunk.toString("utf8"));
    });
    proc.once("error", (error) => {
      this.rpc.fail(`Codex App Server 启动失败：${error.message}`);
    });
    proc.once("exit", () => {
      this.rpc.fail("Codex App Server 已退出");
    });
  }

  get pid(): number | undefined {
    return this.proc.pid;
  }

  get exited(): boolean {
    return this.proc.exitCode !== null || this.proc.signalCode !== null;
  }

  /**
   * 启动 App Server 并完成 initialize 握手。
   * 握手成功后立即发送 initialized 通知，此后才允许其它请求。
   */
  static async start(options: CodexAppServerOptions): Promise<CodexAppServer> {
    writeCodexHomeConfig({
      codexHome: options.codexHome,
      profile: options.profile,
      approvalPolicy: options.approvalPolicy,
      sandbox: options.sandbox,
    });
    const env = buildAppServerEnv({
      codexHome: options.codexHome,
      secretEnvKey: options.profile.secretEnvKey,
      secret: options.secret,
    });
    const spawnFn = options.spawnFn ?? defaultSpawn;
    const proc = spawnFn(options.binaryPath, [...CODEX_APP_SERVER_ARGS], env);
    const server = new CodexAppServer(proc, options);
    await server.handshake(options.handshakeTimeoutMs ?? 15_000);
    return server;
  }

  private async handshake(timeoutMs: number): Promise<void> {
    const params: InitializeParams = {
      clientInfo: {
        name: CODEX_CLIENT_NAME,
        title: CODEX_CLIENT_TITLE,
        version: CODEX_CLIENT_VERSION,
      },
      capabilities: { experimentalApi: false, requestAttestation: false },
    };
    const response = await this.withTimeout(
      this.rpc.request<InitializeParams>("initialize", params),
      timeoutMs,
      "initialize 握手超时",
    );
    if (!isSuccessfulResponse(response)) {
      this.stopped = true;
      this.rpc.dispose();
      this.proc.kill();
      throw new Error(
        `initialize 握手失败：${response?.error?.message ?? "未知错误"}`,
      );
    }
    // 握手后必须回 initialized 通知，否则后续请求会被拒绝。
    this.rpc.notify("initialized", {});
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  private async unwrap<T>(response: JsonRpcResponse, method: string): Promise<T> {
    if (!isSuccessfulResponse(response)) {
      throw new Error(
        `${method} 失败：${response.error?.message ?? "未知错误"}`,
      );
    }
    return response.result as T;
  }

  async threadStart(params: ThreadStartParams): Promise<ThreadStartResult> {
    return this.unwrap<ThreadStartResult>(
      await this.rpc.request<ThreadStartParams>("thread/start", params),
      "thread/start",
    );
  }

  async threadResume(params: ThreadResumeParams): Promise<ThreadResumeResult> {
    return this.unwrap<ThreadResumeResult>(
      await this.rpc.request<ThreadResumeParams>("thread/resume", params),
      "thread/resume",
    );
  }

  async turnStart(params: TurnStartParams): Promise<TurnStartResult> {
    return this.unwrap<TurnStartResult>(
      await this.rpc.request<TurnStartParams>("turn/start", params),
      "turn/start",
    );
  }

  async turnSteer(params: TurnSteerParams): Promise<void> {
    await this.unwrap(
      await this.rpc.request<TurnSteerParams>("turn/steer", params),
      "turn/steer",
    );
  }

  async turnInterrupt(params: TurnInterruptParams): Promise<void> {
    await this.unwrap(
      await this.rpc.request<TurnInterruptParams>("turn/interrupt", params),
      "turn/interrupt",
    );
  }

  /**
   * 发送客户端通知（不期待响应）。仅供测试 setup 与未来扩展使用，
   * 业务方法仍以语义化封装为准。
   */
  rpcNotify<P>(method: string, params: P): void {
    this.rpc.notify(method, params);
  }

  /**
   * 优雅停止：先关闭 stdin 让 App Server 自行退出，超时后强杀。
   * 先持久化后退出（ADR-0015）——调用方需在此之前落盘状态。
   */
  async stop(): Promise<void> {
    if (this.stopped) return this.exitedCode();
    this.stopped = true;
    this.rpc.requestClose();
    const exited = this.exitedCode();
    const timer = setTimeout(() => this.proc.kill(), this.killGraceMs);
    await exited;
    clearTimeout(timer);
  }

  private exitedCode(): Promise<void> {
    this.exitPromise ??= new Promise<void>((resolve) => {
      if (this.exited) return resolve();
      this.proc.once("exit", () => resolve());
    });
    return this.exitPromise;
  }
}

function defaultSpawn(
  binaryPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): ChildProcessWithoutNullStreams {
  return spawn(binaryPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env,
    windowsHide: true,
  });
}
