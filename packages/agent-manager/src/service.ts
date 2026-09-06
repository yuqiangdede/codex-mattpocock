import * as path from "node:path";
import { WorkbenchDatabase } from "@workbench/storage";
import {
  scanProject,
  createWorktree,
  getDiff,
  runVerification,
} from "@workbench/git-worktree";
import {
  IPC_CHANNELS,
  ok,
  err,
  generateId,
  type Project,
  type Task,
  type NormalizedEvent,
  type ApprovalRequest,
  type DiffResult,
  type VerificationResult,
  type IpcResult,
} from "@workbench/shared";
import type {
  ApprovalDecision,
  ServerNotification,
  ServerRequest,
} from "@workbench/protocol";
import { RuntimeSessionManager } from "@workbench/runtime-codex";
import {
  mapApprovalRequest,
  mapCodexNotification,
} from "./codex-event-bridge";

type Handler = (args: unknown[]) => Promise<IpcResult<unknown>>;

export interface AgentManagerOptions {
  dataDir: string;
  notify: (channel: string, payload: unknown) => void;
  /** 可选；未设置时 TURN_START 等运行时方法返回明确错误而不是模拟。 */
  runtime?: RuntimeSessionManager;
}

/**
 * 业务及唯一数据库连接归 Agent Manager 所有，Main 只转发消息。
 * 同时也是 Runtime Session 调度方：持有 RuntimeSessionManager 引用，
 * 并把 Codex 服务端事件翻译为归一化事件后写入存储与广播给 Renderer。
 */
export class AgentManagerService {
  private readonly db: WorkbenchDatabase;
  private readonly dataDir: string;
  private readonly notify: (channel: string, payload: unknown) => void;
  private readonly pendingApprovals = new Map<
    string,
    {
      resolve: (decision: ApprovalDecision) => void;
      serverRequestId: number;
      taskId: string;
      turnId: string;
    }
  >();
  private readonly handlers = new Map<string, Handler>();
  private runtime: RuntimeSessionManager | undefined;
  private readonly startingTasks = new Set<string>();

  constructor(options: AgentManagerOptions) {
    this.dataDir = options.dataDir;
    this.notify = options.notify;
    this.runtime = options.runtime;
    this.db = new WorkbenchDatabase(path.join(options.dataDir, "workbench.db"));
    // Windows 强杀可能跳过退出回调；启动时从事件重建，再持久化恢复决定。
    if (!this.db.recoveryReason) {
      this.db.rebuildProjections();
      this.db.recoverNonTerminalTasks();
    }
    this.setupHandlers();
  }

  /**
   * 进程内替换 Runtime Session Manager（供 agent-manager 入口在加载完
   * Provider Profile 与二进制路径后再注入）。
   */
  attachRuntime(runtime: RuntimeSessionManager): void {
    this.runtime = runtime;
  }

  private register<Args extends unknown[]>(channel: string,
    handler: (...args: Args) => Promise<IpcResult<unknown>>): void {
    this.handlers.set(channel, (args) => handler(...args as Args));
  }

  async request(channel: string, args: unknown[]): Promise<IpcResult<unknown>> {
    if (this.db.recoveryReason && !['project:list', 'task:list', 'task:get', 'recovery:load', 'diff:get'].includes(channel)) {
      return err(`只读 Recovery Mode：${this.db.recoveryReason}`);
    }
    const handler = this.handlers.get(channel);
    if (!handler) return err("未知业务通道");
    return handler(args);
  }

  async close(): Promise<void> {
    try {
      // 退出时持久化中断事件，避免 Renderer 与数据库状态分离。
      for (const pending of this.pendingApprovals.values()) {
        this.db.appendEvent({
          id: generateId('evt'), type: 'TurnInterrupted', taskId: pending.taskId,
          turnId: pending.turnId, payload: { reason: 'manager-shutdown' },
          timestamp: new Date().toISOString(),
        }, { executionState: 'INTERRUPTED', attentionState: 'USER_INPUT' });
      }
      this.pendingApprovals.clear();
      if (this.runtime) {
        await this.runtime.stopAll();
      }
    } finally { this.db.close(); }
  }

  private appendEvent(
    event: NormalizedEvent,
    taskState?: { executionState: string; attentionState: string },
  ): void {
    let inserted: boolean;
    if (taskState) {
      inserted = this.db.appendEvent(event, taskState as { executionState: import("@workbench/shared").ExecutionState; attentionState: import("@workbench/shared").AttentionState });
    } else {
      inserted = this.db.appendEvent(event);
    }
    // 广播存储后的受限载荷，不能把旁路前的 50MB 原文发送给 Renderer。
    if (inserted) this.notify(IPC_CHANNELS.EVENT_STREAM,
      event.taskId ? this.db.getEvents(event.taskId).find(saved => saved.id === event.id) : event);
  }

  private handleCodexNotification(
    taskId: string,
    turnId: string | null,
    notification: ServerNotification,
  ): void {
    const mapping = mapCodexNotification(notification, {
      taskId,
      turnId,
      generateId,
    });
    if (!mapping) return;
    if (mapping.event?.type === 'TurnCompleted') {
      this.db.confirmTurnInputs(taskId, String(mapping.event.payload.turnId));
    }
    if (mapping.event && mapping.taskState) {
      this.appendEvent(mapping.event, mapping.taskState);
    } else if (mapping.event) {
      this.appendEvent(mapping.event);
    }
  }

  private async sendInput(taskId: string, text: string, inputId?: string): Promise<IpcResult<{ turnId: string }>> {
    if (this.startingTasks.has(taskId)) return err('Task 正在启动 Turn');
    this.startingTasks.add(taskId);
    let persistedId = inputId;
    try {
      if (!this.runtime) throw new Error('Runtime Session Manager 未初始化');
      const task = this.db.getTask(taskId);
      if (!task?.worktreePath) throw new Error('Task 尚未创建 Worktree');
      if (task.executionState === 'RUNNING') throw new Error('Task 已在运行');
      let session = this.runtime.getSession(taskId);
      if (!session) {
        const saved = this.db.getRuntimeSession(taskId);
        session = saved
          ? await this.runtime.resumeSession({ taskId, cwd: task.worktreePath, ...saved })
          : await this.runtime.openSession({ taskId, cwd: task.worktreePath });
        this.db.saveRuntimeSession(taskId, session.threadId, session.profileId);
      }
      // 写入成功后才能发送；传输失败不能证明服务端没有执行。
      persistedId ??= this.db.recordInput(taskId, text).id;
      const turnId = await this.runtime.startTurn(taskId, text);
      this.db.bindInputTurn(persistedId, turnId);
      // 通知可能早于请求回执，不能用 ACK 把终态重新改为 RUNNING。
      const completed = this.db.getEvents(taskId).some(event => event.type === 'TurnCompleted' && event.payload.turnId === turnId);
      if (completed) this.db.confirmTurnInputs(taskId, turnId);
      else this.appendEvent({
        id: `${taskId}:${turnId}:started`, type: 'TurnStarted', taskId, turnId,
        payload: { turnId }, timestamp: new Date().toISOString(),
      }, { executionState: 'RUNNING', attentionState: 'NONE' });
      return ok({ turnId });
    } catch (error) {
      if (persistedId) {
        this.db.markInputUncertain(persistedId);
        this.db.updateTaskStates(taskId, 'INTERRUPTED', 'UNCERTAIN');
      }
      return err((error as Error).message);
    } finally { this.startingTasks.delete(taskId); }
  }

  private setupHandlers(): void {
    this.register(IPC_CHANNELS.PROJECT_SCAN, async (dirPath: string): Promise<IpcResult<Project>> => {
      try {
        const scan = scanProject(dirPath);
        const project: Project = {
          id: generateId("proj"),
          name: scan.name,
          path: scan.path,
          toolchain: scan.toolchain,
          createdAt: new Date().toISOString(),
        };
        this.db.insertProject(project);
        this.appendEvent({
          id: generateId("evt"),
          type: "ProjectScanned",
          taskId: null,
          turnId: null,
          payload: { projectId: project.id, ...scan },
          timestamp: project.createdAt,
        });

        return ok(project);
      } catch (e) {
        return err<Project>((e as Error).message);
      }
    });
    this.register(IPC_CHANNELS.PROJECT_LIST, async (): Promise<IpcResult<Project[]>> => {
      try {
        return ok(this.db.listProjects() ?? []);
      } catch (e) {
        return err<Project[]>((e as Error).message);
      }
    });
    this.register(
      IPC_CHANNELS.TASK_CREATE,
      async (projectId: string, prompt: string): Promise<IpcResult<Task>> => {
        try {
          const task: Task = {
            id: generateId("task"),
            projectId,
            prompt,
            lifecycle: "OPEN",
            executionState: "IDLE",
            attentionState: "NONE",
            worktreePath: null,
            worktreeBranch: null,
            createdAt: new Date().toISOString(),
          };
          this.db.insertTask(task);
          this.appendEvent({
            id: generateId("evt"),
            type: "TaskCreated",
            taskId: task.id,
            turnId: null,
            payload: { taskId: task.id, prompt, projectId },
            timestamp: task.createdAt,
          });

          return ok(task);
        } catch (e) {
          return err<Task>((e as Error).message);
        }
      },
    );
    this.register(
      IPC_CHANNELS.TASK_LIST,
      async (projectId?: string): Promise<IpcResult<Task[]>> => {
        try {
          return ok(this.db.listTasks(projectId) ?? []);
        } catch (e) {
          return err<Task[]>((e as Error).message);
        }
      },
    );
    this.register(
      IPC_CHANNELS.TASK_GET,
      async (taskId: string): Promise<IpcResult<Task>> => {
        try {
          const task = this.db.getTask(taskId);
          if (!task) return err<Task>("Task not found");
          return ok(task);
        } catch (e) {
          return err<Task>((e as Error).message);
        }
      },
    );
    this.register(
      IPC_CHANNELS.WORKTREE_CREATE,
      async (taskId: string): Promise<IpcResult<{ path: string; branch: string }>> => {
        try {
          const task = this.db.getTask(taskId);
          if (!task) return err("Task not found");

          const projects = this.db.listProjects() ?? [];
          const project = projects.find((p) => p.id === task.projectId);
          if (!project) return err("Project not found");

          const wt = createWorktree(project.path, taskId, path.join(this.dataDir, "worktrees"));
          this.db.updateTaskWorktree(taskId, wt.path, wt.branch);
          this.appendEvent({
            id: generateId("evt"),
            type: "WorktreeCreated",
            taskId,
            turnId: null,
            payload: { branch: wt.branch, worktreePath: wt.path },
            timestamp: new Date().toISOString(),
          });

          return ok(wt);
        } catch (e) {
          return err<{ path: string; branch: string }>((e as Error).message);
        }
      },
    );
    this.register(IPC_CHANNELS.TURN_START, async (taskId: string) => {
      const task = this.db.getTask(taskId);
      if (!task) return err('Task not found');
      if (this.db.listUncertainInputs().some(input => input.taskId === taskId)) return err('请先处理不确定输入');
      return this.sendInput(taskId, task.prompt);
    });
    this.register(IPC_CHANNELS.INPUT_RESOLVE, async (id: string, action: 'resend' | 'discard') => {
      try {
        const input = this.db.resolveInput(id, action);
        if (action === 'resend') return this.sendInput(input.taskId, input.text, input.id);
        this.appendEvent({ id: generateId('evt'), type: 'InputResolved', taskId: input.taskId,
          turnId: null, payload: { inputId: id, action }, timestamp: new Date().toISOString() },
        { executionState: this.db.listUncertainInputs().some(other => other.taskId === input.taskId) ? 'INTERRUPTED' : 'IDLE', attentionState: 'USER_INPUT' });
        return ok(undefined);
      } catch (error) { return err((error as Error).message); }
    });
    this.register(
      IPC_CHANNELS.TURN_STEER,
      async (taskId: string, text: string): Promise<IpcResult<void>> => {
        let inputId: string | undefined;
        try {
          if (!this.runtime) return err<void>("Runtime Session Manager 未初始化");
          const active = this.runtime.getSession(taskId)?.activeTurnId;
          if (!active) return err<void>('Task 没有活动 Turn');
          inputId = this.db.recordInput(taskId, text).id;
          this.db.bindInputTurn(inputId, active);
          await this.runtime.steerTurn(taskId, text);
          const session = this.runtime.getSession(taskId);
          this.appendEvent({
            id: generateId("evt"),
            type: "TurnSteered",
            taskId,
            turnId: session?.activeTurnId ?? null,
            payload: { text },
            timestamp: new Date().toISOString(),
          });
          return ok(undefined);
        } catch (e) {
          if (inputId) this.db.markInputUncertain(inputId);
          return err<void>((e as Error).message);
        }
      },
    );
    this.register(
      IPC_CHANNELS.TURN_INTERRUPT,
      async (taskId: string): Promise<IpcResult<void>> => {
        try {
          if (!this.runtime) return err<void>("Runtime Session Manager 未初始化");
          await this.runtime.interruptTurn(taskId);
          this.appendEvent({
            id: generateId("evt"),
            type: "TurnInterrupted",
            taskId,
            turnId: null,
            payload: { reason: "user-requested" },
            timestamp: new Date().toISOString(),
          }, { executionState: "INTERRUPTED", attentionState: "USER_INPUT" });
          return ok(undefined);
        } catch (e) {
          return err<void>((e as Error).message);
        }
      },
    );
    this.register(
      IPC_CHANNELS.APPROVAL_DECIDE,
      async (approvalId: string, decision: "approved" | "denied"): Promise<IpcResult<void>> => {
        try {
          const pending = this.pendingApprovals.get(approvalId);
          if (!pending) return err<void>("Approval request not found");

          this.pendingApprovals.delete(approvalId);
          const codexDecision: ApprovalDecision =
            decision === "approved" ? "accept" : "decline";
          pending.resolve(codexDecision);

          this.appendEvent({
            id: generateId("evt"),
            type: "ApprovalDecided",
            taskId: pending.taskId,
            turnId: pending.turnId,
            payload: { approvalId, decision, serverRequestId: pending.serverRequestId },
            timestamp: new Date().toISOString(),
          }, { executionState: "IDLE", attentionState: "NONE" });

          return ok(undefined);
        } catch (e) {
          return err<void>((e as Error).message);
        }
      },
    );
    this.register(
      IPC_CHANNELS.DIFF_GET,
      async (taskId: string): Promise<IpcResult<DiffResult>> => {
        try {
          const task = this.db.getTask(taskId);
          if (!task?.worktreePath) return err<DiffResult>("No worktree for task");

          const diff = getDiff(task.worktreePath);
          diff.taskId = taskId;

          return ok(diff);
        } catch (e) {
          return err<DiffResult>((e as Error).message);
        }
      },
    );
    this.register(
      IPC_CHANNELS.VERIFY_RUN,
      async (taskId: string): Promise<IpcResult<VerificationResult>> => {
        try {
          const task = this.db.getTask(taskId);
          if (!task?.worktreePath) return err<VerificationResult>("No worktree for task");
          const result = runVerification(task.worktreePath, "npm test");
          result.taskId = taskId;
          this.appendEvent({
            id: generateId("evt"),
            type: "VerificationCompleted",
            taskId,
            turnId: null,
            payload: { exitCode: result.exitCode, passed: result.passed },
            timestamp: new Date().toISOString(),
          });
          if (result.passed) {
            this.db.updateTaskStates(taskId, "IDLE", "NONE");
          }

          return ok(result);
        } catch (e) {
          return err<VerificationResult>((e as Error).message);
        }
      },
    );
    this.register(
      IPC_CHANNELS.RECOVERY_LOAD,
      async (): Promise<IpcResult<{ tasks: Task[]; events: NormalizedEvent[] }>> => {
        try {
          const tasks = this.db.listTasks() ?? [];
          const events = this.db.getAllEvents() ?? [];
          return ok({ tasks, events, uncertainInputs: this.db.listUncertainInputs(), recoveryReason: this.db.recoveryReason });
        } catch (e) {
          return err<{ tasks: Task[]; events: NormalizedEvent[] }>((e as Error).message);
        }
      },
    );
  }

  /**
   * 由 agent-manager 入口在装配好 RuntimeSessionManager 后调用，
   * 把 Codex 服务端事件桥接到领域事件流。
   */
  wireRuntimeCallbacks(): void {
    if (!this.runtime) return;
    this.runtime.setCallbacks({
      onNotification: (session, notification: ServerNotification) => {
        this.handleCodexNotification(session.taskId, session.activeTurnId, notification);
      },
      onApprovalRequest: (session, request: ServerRequest) => {
        const { approval, serverRequestId } = mapApprovalRequest(request, {
          taskId: session.taskId,
          turnId: session.activeTurnId ?? "",
        });
        return new Promise<ApprovalDecision>((resolve) => {
          const approvalId = generateId("appr");
          const fullApproval: ApprovalRequest = { id: approvalId, ...approval };
          this.pendingApprovals.set(approvalId, {
            resolve,
            serverRequestId,
            taskId: session.taskId,
            turnId: fullApproval.turnId,
          });
          this.notify(IPC_CHANNELS.APPROVAL_REQUEST, fullApproval);
        });
      },
    });
  }
}
