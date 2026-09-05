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


type Handler = (args: unknown[]) => Promise<IpcResult<unknown>>;

/** 业务及唯一数据库连接归 Agent Manager 所有，Main 只转发消息。 */
export class AgentManagerService {
  private readonly db: WorkbenchDatabase;
  private readonly pendingApprovals = new Map<string, ApprovalRequest>();
  private readonly handlers = new Map<string, Handler>();

  constructor(private readonly dataDir: string,
    private readonly notify: (channel: string, payload: unknown) => void) {
    this.db = new WorkbenchDatabase(path.join(dataDir, "workbench.db"));
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

  private register<Args extends unknown[]>(channel: string,
    handler: (...args: Args) => Promise<IpcResult<unknown>>): void {
    this.handlers.set(channel, (args) => handler(...args as Args));
  }

  async request(channel: string, args: unknown[]): Promise<IpcResult<unknown>> {
    const handler = this.handlers.get(channel);
    if (!handler) return err("未知业务通道");
    return handler(args);
  }

  close(): void {
    try {
      // 当前仍为 M1 模拟 Turn；退出时先保存中断状态，不重放待审批操作。
      for (const approval of this.pendingApprovals.values()) {
        this.db.appendEvent({
          id: generateId('evt'), type: 'TurnInterrupted', taskId: approval.taskId,
          turnId: approval.turnId, payload: { reason: 'manager-shutdown' },
          timestamp: new Date().toISOString(),
        }, { executionState: 'INTERRUPTED', attentionState: 'USER_INPUT' });
      }
      this.pendingApprovals.clear();
    } finally { this.db.close(); }
  }

  private appendEvent(event: NormalizedEvent): void {
    this.db.appendEvent(event);
    this.notify(IPC_CHANNELS.EVENT_STREAM, event);
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
          const task = this.db.getTask(taskId);
          if (!task) return err("Task not found");

          const turnId = generateId("turn");
          this.db.updateTaskStates(taskId, "RUNNING", "NONE");
          this.appendEvent({
            id: generateId("evt"),
            type: "TurnStarted",
            taskId,
            turnId,
            payload: { turnId, prompt: task.prompt },
            timestamp: new Date().toISOString(),
          });
          const approval: ApprovalRequest = {
            id: generateId("appr"),
            taskId,
            turnId,
            type: "file",
            target: "index.ts",
            summary: "Write hello() function to index.ts",
          };
          this.pendingApprovals.set(approval.id, approval);
          this.notify(IPC_CHANNELS.APPROVAL_REQUEST, approval);

          return ok({ turnId });
        } catch (e) {
          return err<{ turnId: string }>((e as Error).message);
        }
      },
    );
    this.register(
      IPC_CHANNELS.APPROVAL_DECIDE,
      async (approvalId: string, decision: "approved" | "denied"): Promise<IpcResult<void>> => {
        try {
          const approval = this.pendingApprovals.get(approvalId);
          if (!approval) return err("Approval request not found");

          this.pendingApprovals.delete(approvalId);
          this.appendEvent({
            id: generateId("evt"),
            type: "ApprovalDecided",
            taskId: approval.taskId,
            turnId: approval.turnId,
            payload: { approvalId, decision, type: approval.type, target: approval.target },
            timestamp: new Date().toISOString(),
          });

          if (decision === "approved") {
            const task = this.db.getTask(approval.taskId);
            if (task?.worktreePath) {
              const { writeFileSync } = await import("node:fs");
              const indexPath = path.join(task.worktreePath, "index.ts");
              writeFileSync(indexPath, `export function hello(): string {\n  return "hello world";\n}\n`, "utf8");
            }
            this.db.updateTaskStates(approval.taskId, "IDLE", "NONE");
            this.appendEvent({
              id: generateId("evt"),
              type: "TurnCompleted",
              taskId: approval.taskId,
              turnId: approval.turnId,
              payload: { status: "completed", diffSummary: "1 file modified" },
              timestamp: new Date().toISOString(),
            });
          } else {
            this.db.updateTaskStates(approval.taskId, "IDLE", "APPROVAL");
          }

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


}
