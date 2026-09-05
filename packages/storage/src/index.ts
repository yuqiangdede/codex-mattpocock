/**
 * @workbench/storage
 *
 * SQLite storage layer using node:sqlite DatabaseSync.
 * Agent Manager owns the sole write connection.
 *
 * All events are written in a single transaction with:
 * 1. Normalized Event — canonical event record
 * 2. Projection — materialized view for fast UI queries
 * 3. Attention Outbox — pending UI notifications
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  NormalizedEvent,
  Task,
  TaskProjection,
  Project,
} from "@workbench/shared";

export class WorkbenchDatabase {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    // Ensure parent dir exists
    const parent = dirname(dbPath);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);

    // Initialize pragmas
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA synchronous=FULL");
    this.db.exec("PRAGMA foreign_keys=ON");
    this.db.exec("PRAGMA trusted_schema=OFF");
    this.db.exec("PRAGMA busy_timeout=5000");

    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        toolchain TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        lifecycle TEXT NOT NULL DEFAULT 'OPEN',
        execution_state TEXT NOT NULL DEFAULT 'IDLE',
        attention_state TEXT NOT NULL DEFAULT 'NONE',
        worktree_path TEXT,
        worktree_branch TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        task_id TEXT,
        turn_id TEXT,
        payload TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_events_task_id ON events(task_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

      CREATE TABLE IF NOT EXISTS projections (
        task_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        timeline_summary TEXT NOT NULL,
        last_event_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS attention_outbox (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        delivered INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
    `);
  }

  // ================================================================
  // Project operations
  // ================================================================

  insertProject(project: Project): void {
    this.db
      .prepare(
        "INSERT INTO projects (id, name, path, toolchain, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        project.id,
        project.name,
        project.path,
        JSON.stringify(project.toolchain),
        project.createdAt,
      );
  }

  listProjects(): Project[] {
    const rows = this.db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      name: row.name as string,
      path: row.path as string,
      toolchain: JSON.parse(row.toolchain as string) as string[],
      createdAt: row.created_at as string,
    }));
  }

  // ================================================================
  // Task operations
  // ================================================================

  insertTask(task: Task): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, project_id, prompt, lifecycle, execution_state, attention_state, worktree_path, worktree_branch, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.projectId,
        task.prompt,
        task.lifecycle,
        task.executionState,
        task.attentionState,
        task.worktreePath,
        task.worktreeBranch,
        task.createdAt,
      );
  }

  updateTaskWorktree(taskId: string, worktreePath: string, worktreeBranch: string): void {
    this.db
      .prepare("UPDATE tasks SET worktree_path = ?, worktree_branch = ? WHERE id = ?")
      .run(worktreePath, worktreeBranch, taskId);
  }

  updateTaskStates(
    taskId: string,
    executionState: string,
    attentionState: string,
  ): void {
    this.db
      .prepare(
        "UPDATE tasks SET execution_state = ?, attention_state = ? WHERE id = ?",
      )
      .run(executionState, attentionState, taskId);
  }

  listTasks(projectId?: string): Task[] {
    const sql = projectId
      ? "SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC"
      : "SELECT * FROM tasks ORDER BY created_at DESC";
    const stmt = this.db.prepare(sql);
    const rows = projectId ? stmt.all(projectId) : stmt.all();
    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      projectId: row.project_id as string,
      prompt: row.prompt as string,
      lifecycle: row.lifecycle as Task["lifecycle"],
      executionState: row.execution_state as Task["executionState"],
      attentionState: row.attention_state as Task["attentionState"],
      worktreePath: (row.worktree_path as string) ?? null,
      worktreeBranch: (row.worktree_branch as string) ?? null,
      createdAt: row.created_at as string,
    }));
  }

  getTask(taskId: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!row) return null;
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      projectId: r.project_id as string,
      prompt: r.prompt as string,
      lifecycle: r.lifecycle as Task["lifecycle"],
      executionState: r.execution_state as Task["executionState"],
      attentionState: r.attention_state as Task["attentionState"],
      worktreePath: (r.worktree_path as string) ?? null,
      worktreeBranch: (r.worktree_branch as string) ?? null,
      createdAt: r.created_at as string,
    };
  }

  // ================================================================
  // Event operations (single transaction: event + projection + outbox)
  // ================================================================

  appendEvent(event: NormalizedEvent, taskState?: Pick<Task, 'executionState' | 'attentionState'>): void {
    this.db.exec("BEGIN TRANSACTION");
    try {
      // 进程中断的状态与事件必须原子落盘，避免任务状态和 Timeline 分离。
      if (taskState) {
        if (!event.taskId) throw new Error('状态变更事件必须关联 Task');
        this.updateTaskStates(event.taskId, taskState.executionState, taskState.attentionState);
      }
      // Insert normalized event
      this.db
        .prepare(
          "INSERT INTO events (id, type, task_id, turn_id, payload, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          event.id,
          event.type,
          event.taskId,
          event.turnId,
          JSON.stringify(event.payload),
          event.timestamp,
        );

      // Upsert projection
      const existing = this.db
        .prepare("SELECT * FROM projections WHERE task_id = ?")
        .get(event.taskId ?? "");
      if (existing && event.taskId) {
        const proj = existing as Record<string, unknown>;
        const timeline = JSON.parse(proj.timeline_summary as string) as string[];
        timeline.push(`${event.type} @ ${event.timestamp}`);
        this.db
          .prepare(
            "UPDATE projections SET status = ?, timeline_summary = ?, last_event_at = ? WHERE task_id = ?",
          )
          .run(
            event.type,
            JSON.stringify(timeline),
            event.timestamp,
            event.taskId,
          );
      } else if (event.taskId) {
        this.db
          .prepare(
            "INSERT INTO projections (task_id, status, timeline_summary, last_event_at) VALUES (?, ?, ?, ?)",
          )
          .run(
            event.taskId,
            event.type,
            JSON.stringify([`${event.type} @ ${event.timestamp}`]),
            event.timestamp,
          );
      }

      // Insert attention outbox entry
      if (event.taskId) {
        this.db
          .prepare(
            "INSERT INTO attention_outbox (id, task_id, event_id, delivered, created_at) VALUES (?, ?, ?, 0, ?)",
          )
          .run(
            `${event.id}-outbox`,
            event.taskId,
            event.id,
            event.timestamp,
          );
      }

      this.db.exec("COMMIT");
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw err;
    }
  }

  getEvents(taskId: string): NormalizedEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE task_id = ? ORDER BY timestamp ASC")
      .all(taskId);
    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      type: row.type as NormalizedEvent["type"],
      taskId: (row.task_id as string) ?? null,
      turnId: (row.turn_id as string) ?? null,
      payload: JSON.parse(row.payload as string) as Record<string, unknown>,
      timestamp: row.timestamp as string,
    }));
  }

  getProjection(taskId: string): TaskProjection | null {
    const row = this.db
      .prepare("SELECT * FROM projections WHERE task_id = ?")
      .get(taskId);
    if (!row) return null;
    const r = row as Record<string, unknown>;
    return {
      taskId: r.task_id as string,
      status: r.status as string,
      timelineSummary: JSON.parse(r.timeline_summary as string) as string[],
      lastEventAt: r.last_event_at as string,
    };
  }

  // ================================================================
  // Recovery
  // ================================================================

  getAllEvents(): NormalizedEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM events ORDER BY timestamp ASC")
      .all();
    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      type: row.type as NormalizedEvent["type"],
      taskId: (row.task_id as string) ?? null,
      turnId: (row.turn_id as string) ?? null,
      payload: JSON.parse(row.payload as string) as Record<string, unknown>,
      timestamp: row.timestamp as string,
    }));
  }

  close(): void {
    this.db.close();
  }
}
