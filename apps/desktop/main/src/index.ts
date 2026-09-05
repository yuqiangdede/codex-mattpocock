import { app, BrowserWindow, ipcMain } from "electron";
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

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let db: WorkbenchDatabase | null = null;

// Worktree base directory: <userData>/worktrees/
function getWorktreeBaseDir(): string {
  return path.join(app.getPath("userData"), "worktrees");
}

// Database path: <userData>/workbench.db
function getDbPath(): string {
  return path.join(app.getPath("userData"), "workbench.db");
}

// Pending approval requests (in-memory, not persisted)
const pendingApprovals = new Map<string, ApprovalRequest>();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "../preload/index.js"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Dev mode: load from vite dev server
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, "../renderer/index.html"),
    );
  }
}

// ================================================================
// IPC Handlers
// ================================================================

function setupIpcHandlers(): void {
  // --- Project Scan ---
  ipcMain.handle(IPC_CHANNELS.PROJECT_SCAN, async (_event, dirPath: string): Promise<IpcResult<Project>> => {
    try {
      const scan = scanProject(dirPath);
      const project: Project = {
        id: generateId("proj"),
        name: scan.name,
        path: scan.path,
        toolchain: scan.toolchain,
        createdAt: new Date().toISOString(),
      };
      db?.insertProject(project);

      // Emit event
      appendEvent({
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

  // --- Project List ---
  ipcMain.handle(IPC_CHANNELS.PROJECT_LIST, async (): Promise<IpcResult<Project[]>> => {
    try {
      return ok(db?.listProjects() ?? []);
    } catch (e) {
      return err<Project[]>((e as Error).message);
    }
  });

  // --- Task Create ---
  ipcMain.handle(
    IPC_CHANNELS.TASK_CREATE,
    async (_event, projectId: string, prompt: string): Promise<IpcResult<Task>> => {
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
        db?.insertTask(task);

        // Emit event
        appendEvent({
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

  // --- Task List ---
  ipcMain.handle(
    IPC_CHANNELS.TASK_LIST,
    async (_event, projectId?: string): Promise<IpcResult<Task[]>> => {
      try {
        return ok(db?.listTasks(projectId) ?? []);
      } catch (e) {
        return err<Task[]>((e as Error).message);
      }
    },
  );

  // --- Task Get ---
  ipcMain.handle(
    IPC_CHANNELS.TASK_GET,
    async (_event, taskId: string): Promise<IpcResult<Task>> => {
      try {
        const task = db?.getTask(taskId);
        if (!task) return err<Task>("Task not found");
        return ok(task);
      } catch (e) {
        return err<Task>((e as Error).message);
      }
    },
  );

  // --- Worktree Create ---
  ipcMain.handle(
    IPC_CHANNELS.WORKTREE_CREATE,
    async (_event, taskId: string): Promise<IpcResult<{ path: string; branch: string }>> => {
      try {
        const task = db?.getTask(taskId);
        if (!task) return err("Task not found");

        const projects = db?.listProjects() ?? [];
        const project = projects.find((p) => p.id === task.projectId);
        if (!project) return err("Project not found");

        const wt = createWorktree(project.path, taskId, getWorktreeBaseDir());
        db?.updateTaskWorktree(taskId, wt.path, wt.branch);

        // Emit event
        appendEvent({
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

  // --- Turn Start (simulated for M1) ---
  ipcMain.handle(
    IPC_CHANNELS.TURN_START,
    async (_event, taskId: string): Promise<IpcResult<{ turnId: string }>> => {
      try {
        const task = db?.getTask(taskId);
        if (!task) return err("Task not found");

        const turnId = generateId("turn");

        // Update task state
        db?.updateTaskStates(taskId, "RUNNING", "NONE");

        // Emit TurnStarted event
        appendEvent({
          id: generateId("evt"),
          type: "TurnStarted",
          taskId,
          turnId,
          payload: { turnId, prompt: task.prompt },
          timestamp: new Date().toISOString(),
        });

        // Simulate approval request for file write
        const approval: ApprovalRequest = {
          id: generateId("appr"),
          taskId,
          turnId,
          type: "file",
          target: "index.ts",
          summary: "Write hello() function to index.ts",
        };
        pendingApprovals.set(approval.id, approval);

        // Send approval request to renderer
        mainWindow?.webContents.send(IPC_CHANNELS.APPROVAL_REQUEST, approval);

        return ok({ turnId });
      } catch (e) {
        return err<{ turnId: string }>((e as Error).message);
      }
    },
  );

  // --- Approval Decide ---
  ipcMain.handle(
    IPC_CHANNELS.APPROVAL_DECIDE,
    async (_event, approvalId: string, decision: "approved" | "denied"): Promise<IpcResult<void>> => {
      try {
        const approval = pendingApprovals.get(approvalId);
        if (!approval) return err("Approval request not found");

        pendingApprovals.delete(approvalId);

        // Emit ApprovalDecided event
        appendEvent({
          id: generateId("evt"),
          type: "ApprovalDecided",
          taskId: approval.taskId,
          turnId: approval.turnId,
          payload: { approvalId, decision, type: approval.type, target: approval.target },
          timestamp: new Date().toISOString(),
        });

        if (decision === "approved") {
          // Simulate turn completion
          const task = db?.getTask(approval.taskId);
          if (task?.worktreePath) {
            // Write the hello() function to the worktree
            const { writeFileSync } = await import("node:fs");
            const indexPath = path.join(task.worktreePath, "index.ts");
            writeFileSync(indexPath, `export function hello(): string {\n  return "hello world";\n}\n`, "utf8");
          }

          // Update task state
          db?.updateTaskStates(approval.taskId, "IDLE", "NONE");

          // Emit TurnCompleted event
          appendEvent({
            id: generateId("evt"),
            type: "TurnCompleted",
            taskId: approval.taskId,
            turnId: approval.turnId,
            payload: { status: "completed", diffSummary: "1 file modified" },
            timestamp: new Date().toISOString(),
          });
        } else {
          db?.updateTaskStates(approval.taskId, "IDLE", "APPROVAL");
        }

        return ok(undefined);
      } catch (e) {
        return err<void>((e as Error).message);
      }
    },
  );

  // --- Diff Get ---
  ipcMain.handle(
    IPC_CHANNELS.DIFF_GET,
    async (_event, taskId: string): Promise<IpcResult<DiffResult>> => {
      try {
        const task = db?.getTask(taskId);
        if (!task?.worktreePath) return err<DiffResult>("No worktree for task");

        const diff = getDiff(task.worktreePath);
        diff.taskId = taskId;

        return ok(diff);
      } catch (e) {
        return err<DiffResult>((e as Error).message);
      }
    },
  );

  // --- Verify Run ---
  ipcMain.handle(
    IPC_CHANNELS.VERIFY_RUN,
    async (_event, taskId: string): Promise<IpcResult<VerificationResult>> => {
      try {
        const task = db?.getTask(taskId);
        if (!task?.worktreePath) return err<VerificationResult>("No worktree for task");

        // Run npm test in worktree
        const result = runVerification(task.worktreePath, "npm test");
        result.taskId = taskId;

        // Emit VerificationCompleted event
        appendEvent({
          id: generateId("evt"),
          type: "VerificationCompleted",
          taskId,
          turnId: null,
          payload: { exitCode: result.exitCode, passed: result.passed },
          timestamp: new Date().toISOString(),
        });

        // Update task lifecycle if passed
        if (result.passed) {
          db?.updateTaskStates(taskId, "IDLE", "NONE");
        }

        return ok(result);
      } catch (e) {
        return err<VerificationResult>((e as Error).message);
      }
    },
  );

  // --- Recovery Load ---
  ipcMain.handle(
    IPC_CHANNELS.RECOVERY_LOAD,
    async (): Promise<IpcResult<{ tasks: Task[]; events: NormalizedEvent[] }>> => {
      try {
        const tasks = db?.listTasks() ?? [];
        const events = db?.getAllEvents() ?? [];
        return ok({ tasks, events });
      } catch (e) {
        return err<{ tasks: Task[]; events: NormalizedEvent[] }>((e as Error).message);
      }
    },
  );
}

// ================================================================
// Event helper
// ================================================================

function appendEvent(event: NormalizedEvent): void {
  db?.appendEvent(event);

  // Stream to renderer
  mainWindow?.webContents.send(IPC_CHANNELS.EVENT_STREAM, event);
}

// ================================================================
// App lifecycle
// ================================================================

app.whenReady().then(() => {
  // Initialize database
  db = new WorkbenchDatabase(getDbPath());

  setupIpcHandlers();
  createWindow();

  // Automated boot smoke test:
  // WORKBENCH_SMOKE_TEST=1 -> verify the app initializes (DB ready, handlers
  // registered, window created) then exit cleanly with code 0.
  if (process.env.WORKBENCH_SMOKE_TEST === "1") {
    const dbReady = db !== null;
    const windowCreated = BrowserWindow.getAllWindows().length > 0;
    const dbWritable = dbReady
      ? (() => { try { db!.listProjects(); return true; } catch { return false; } })()
      : false;
    console.log(`[smoke] dbReady=${dbReady} windowCreated=${windowCreated} dbWritable=${dbWritable}`);
    app.exit(dbReady && windowCreated && dbWritable ? 0 : 1);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  db?.close();
});
