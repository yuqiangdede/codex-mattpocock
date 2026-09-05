/**
 * Runtime Session 生命周期管理。
 *
 * 领域术语（CONTEXT.md）：Runtime Session 是由某个 Agent Runtime 管理的
 * 连续执行上下文，与 Task 关联但不等同于 Task。Codex 的 Thread 只是它的
 * 实现载体，本模块对外不暴露 Thread 概念。
 *
 * 进程模型：每个 Provider Profile 一个 App Server 进程，跨 Task 共享。
 */

import type {
  ApprovalDecision,
  ServerNotification,
  ServerRequest,
  ThreadStartParams,
} from "@workbench/protocol";
import { CodexAppServer, textInput, type SpawnFn } from "./app-server.js";
import { ProviderProfileStore, type ProviderProfile } from "./provider-profile.js";
import { ProviderSecretStore } from "./secret-helper.js";

export interface RuntimeSession {
  readonly taskId: string;
  readonly profileId: string;
  readonly threadId: string;
  readonly cwd: string;
  activeTurnId: string | null;
}

export interface OpenSessionRequest {
  taskId: string;
  cwd: string;
  profileId?: string;
}

export interface ResumeSessionRequest extends OpenSessionRequest {
  threadId: string;
}

export interface RuntimeSessionManagerOptions {
  binaryPath: string;
  /** 隔离 CODEX_HOME 的根目录；每个 Profile 一个子目录。 */
  codexHomeRoot: string;
  configDir: string;
  approvalPolicy: ThreadStartParams["approvalPolicy"];
  sandbox: ThreadStartParams["sandbox"];
  onNotification: (session: RuntimeSession, notification: ServerNotification) => void;
  onApprovalRequest: (
    session: RuntimeSession,
    request: ServerRequest,
  ) => Promise<ApprovalDecision>;
  onStderr?: (chunk: string) => void;
  spawnFn?: SpawnFn;
}

export class RuntimeSessionManager {
  private readonly servers = new Map<string, CodexAppServer>();
  private readonly starting = new Map<string, Promise<CodexAppServer>>();
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly byThreadId = new Map<string, RuntimeSession>();
  private readonly profiles: ProviderProfileStore;
  private readonly secrets: ProviderSecretStore;

  constructor(private readonly options: RuntimeSessionManagerOptions) {
    this.profiles = new ProviderProfileStore(options.configDir);
    this.secrets = new ProviderSecretStore(options.configDir);
  }

  /**
   * 替换事件与审批回调。已存在的 App Server 进程不受影响，
   * 下次 serverFor 触发时会按新回调重连。
   */
  setCallbacks(options: {
    onNotification: RuntimeSessionManagerOptions["onNotification"];
    onApprovalRequest: RuntimeSessionManagerOptions["onApprovalRequest"];
    onStderr?: RuntimeSessionManagerOptions["onStderr"];
  }): void {
    this.options.onNotification = options.onNotification;
    this.options.onApprovalRequest = options.onApprovalRequest;
    if (options.onStderr) this.options.onStderr = options.onStderr;
  }

  /**
   * 每个 Profile 只起一个 App Server。并发调用共享同一个启动 Promise，
   * 否则同一 Profile 的多个 Task 会各起一个进程。
   */
  private serverFor(profile: ProviderProfile): Promise<CodexAppServer> {
    const existing = this.servers.get(profile.id);
    if (existing && !existing.exited) return Promise.resolve(existing);

    const inFlight = this.starting.get(profile.id);
    if (inFlight) return inFlight;

    const starting = this.launchServer(profile).finally(() =>
      this.starting.delete(profile.id),
    );
    this.starting.set(profile.id, starting);
    return starting;
  }

  private async launchServer(profile: ProviderProfile): Promise<CodexAppServer> {
    this.servers.delete(profile.id);
    const server = await CodexAppServer.start({
      binaryPath: this.options.binaryPath,
      codexHome: `${this.options.codexHomeRoot}-${profile.id}`,
      profile,
      secret: this.secrets.readSecret(profile.id),
      approvalPolicy: this.options.approvalPolicy,
      sandbox: this.options.sandbox,
      spawnFn: this.options.spawnFn,
      onStderr: this.options.onStderr,
      onNotification: (notification) => {
        this.sessionForNotification(notification, (session) =>
          this.options.onNotification(session, notification),
        );
      },
      onApprovalRequest: (request) => {
        const session = this.byThreadId.get(
          readThreadId(request.params) ?? "",
        );
        if (!session) {
          // 找不到归属会话时拒绝放行，避免无人值守的写操作。
          return Promise.resolve<ApprovalDecision>("decline");
        }
        return this.options.onApprovalRequest(session, request);
      },
    });
    this.servers.set(profile.id, server);
    return server;
  }

  /** 通知按 threadId 归属到会话；无归属时丢弃（如 remoteControl 全局通知）。 */
  private sessionForNotification(
    notification: ServerNotification,
    deliver: (session: RuntimeSession) => void,
  ): void {
    const threadId = readThreadId(notification.params);
    if (!threadId) return;
    const session = this.byThreadId.get(threadId);
    if (session) deliver(session);
  }

  private async resolveProfile(profileId?: string): Promise<ProviderProfile> {
    const profile = profileId
      ? this.profiles.get(profileId)
      : this.profiles.defaultProfile();
    if (!profile) {
      throw new Error(
        profileId
          ? `未配置的 Provider Profile：${profileId}`
          : "尚未配置任何 Provider Profile，无法启动 Runtime Session",
      );
    }
    return profile;
  }

  /** 新建 Runtime Session：为该 Task 开一个 Codex Thread。 */
  async openSession(request: OpenSessionRequest): Promise<RuntimeSession> {
    const profile = await this.resolveProfile(request.profileId);
    const server = await this.serverFor(profile);
    const result = await server.threadStart({
      cwd: request.cwd,
      approvalPolicy: this.options.approvalPolicy,
      sandbox: this.options.sandbox,
      serviceName: "coding-agent-workbench",
      model: profile.modelId,
      modelProvider: profile.id,
    });
    return this.register({
      taskId: request.taskId,
      profileId: profile.id,
      threadId: result.thread.id,
      cwd: request.cwd,
      activeTurnId: null,
    });
  }

  /** 恢复既有 Runtime Session（跨重启由持久化 threadId 驱动）。 */
  async resumeSession(request: ResumeSessionRequest): Promise<RuntimeSession> {
    const profile = await this.resolveProfile(request.profileId);
    const server = await this.serverFor(profile);
    const result = await server.threadResume({ threadId: request.threadId });
    if (result.thread.id !== request.threadId) {
      throw new Error(
        `Runtime Session 恢复后 ID 不一致：${request.threadId} → ${result.thread.id}`,
      );
    }
    return this.register({
      taskId: request.taskId,
      profileId: profile.id,
      threadId: request.threadId,
      cwd: request.cwd,
      activeTurnId: null,
    });
  }

  private register(session: RuntimeSession): RuntimeSession {
    this.sessions.set(session.taskId, session);
    this.byThreadId.set(session.threadId, session);
    return session;
  }

  getSession(taskId: string): RuntimeSession | undefined {
    return this.sessions.get(taskId);
  }

  /** 在 Runtime Session 上启动一个 Turn。 */
  async startTurn(taskId: string, prompt: string): Promise<string> {
    const session = this.requireSession(taskId);
    const server = await this.serverFor(
      (await this.resolveProfile(session.profileId)),
    );
    const result = await server.turnStart({
      threadId: session.threadId,
      input: textInput(prompt),
    });
    session.activeTurnId = result.turn.id;
    return result.turn.id;
  }

  /** 向正在执行的 Turn 注入即时调整（非排队输入）。 */
  async steerTurn(taskId: string, text: string): Promise<void> {
    const session = this.requireSession(taskId);
    if (!session.activeTurnId) throw new Error("当前没有正在执行的 Turn");
    const server = await this.serverFor(
      await this.resolveProfile(session.profileId),
    );
    await server.turnSteer({
      threadId: session.threadId,
      expectedTurnId: session.activeTurnId,
      input: textInput(text),
    });
  }

  /** 中断正在执行的 Turn。 */
  async interruptTurn(taskId: string): Promise<void> {
    const session = this.requireSession(taskId);
    if (!session.activeTurnId) return;
    const server = await this.serverFor(
      await this.resolveProfile(session.profileId),
    );
    await server.turnInterrupt({
      threadId: session.threadId,
      turnId: session.activeTurnId,
    });
    session.activeTurnId = null;
  }

  private requireSession(taskId: string): RuntimeSession {
    const session = this.sessions.get(taskId);
    if (!session) throw new Error(`Task ${taskId} 没有活动的 Runtime Session`);
    return session;
  }

  /** 关闭单个会话的映射；App Server 进程按 Profile 共享，不随会话关闭。 */
  closeSession(taskId: string): void {
    const session = this.sessions.get(taskId);
    if (!session) return;
    this.byThreadId.delete(session.threadId);
    this.sessions.delete(taskId);
  }

  /** 停止全部 App Server 进程。退出路径：先由调用方持久化，再调用此处。 */
  async stopAll(): Promise<void> {
    const servers = [...this.servers.values()];
    this.servers.clear();
    this.sessions.clear();
    this.byThreadId.clear();
    await Promise.all(servers.map((server) => server.stop()));
  }
}

function readThreadId(params: unknown): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const value = (params as Record<string, unknown>).threadId;
  return typeof value === "string" ? value : undefined;
}
