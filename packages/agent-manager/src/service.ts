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

  constructor(options: AgentManagerOptions) {
    this.dataDir = options.dataDir;
    this.notify = options.notify;
    this.runtime = options.runtime;
    this.db = new WorkbenchDatabase(path.join(options.dataDir, "workbench.db"));
    // Windows 强杀 Main 时可能同时终止 Utility Process，无法依赖退出回调。
    // 这里只阻止遗留 RUNNING 状态被当作仍在执行；完整恢复协调由 03 工单负责。
    for (const task of this.db.listTasks()) {
      if (task.executionState === 'RUNNING') {
        this.db.appendEvent({
          id: generateId('evt'), type: 'TurnInterrupted', taskId: task.id,
          turnId: null, payload: { reason: 'unclean-manager-exit' },
          timestamp: new Date().toISOString(),
        }, { executionState: 'INTERRUPTED', attentionState: 'UNCERTAIN' });
      }
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
    if (taskState) {
      this.db.appendEvent(event, taskState as { executionState: import("@workbench/shared").ExecutionState; attentionState: import("@workbench/shared").AttentionState });
    } else {
      this.db.appendEvent(event);
    }
    this.notify(IPC_CHANNELS.EVENT_STREAM, event);
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
    if (mapping.event && mapping.taskState) {
      this.appendEvent(mapping.event, mapping.taskState);
    } else if (mapping.event) {
      this.appendEvent(mapping.event);
    }
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
    this.register(
      IPC_CHANNELS.TURN_START,
      async (taskId: string): Promise<IpcResult<{ turnId: string }>> => {
        try {
          if (!this.runtime) {
            return err<{ turnId: string }>("Runtime Session Manager 未初始化");
          }
          const task = this.db.getTask(taskId);
          if (!task) return err<{ turnId: string }>("Task not found");
          if (!task.worktreePath) {
            return err<{ turnId: string }>("Task 尚未创建 Worktree");
          }

          // 同一 Task 重复 startTurn：复用既有 Runtime Session；
          // 还没有会话时按 worktree 目录启动 thread。
          let session = this.runtime.getSession(taskId);
          if (!session) {
            session = await this.runtime.openSession({
              taskId,
              cwd: task.worktreePath,
            });
          }
          this.db.updateTaskStates(taskId, "RUNNING", "NONE");
          const turnId = await this.runtime.startTurn(taskId, task.prompt);

          // 服务端回执前先行广播 TurnStarted，让 Renderer 立刻有反馈；
          // 服务端的 turn/started 通知会再次落到事件流并被 handleCodexNotification 归并。
          this.appendEvent({
            id: generateId("evt"),
            type: "TurnStarted",
            taskId,
            turnId,
            payload: { turnId, prompt: task.prompt, threadId: session.threadId },
            timestamp: new Date().toISOString(),
          });

          return ok({ turnId });
        } catch (e) {
          return err<{ turnId: string }>((e as Error).message);
        }
      },
    );
    this.register(
      IPC_CHANNELS.TURN_STEER,
      async (taskId: string, text: string): Promise<IpcResult<void>> => {
        try {
          if (!this.runtime) return err<void>("Runtime Session Manager 未初始化");
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
          return ok({ tasks, events });
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