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
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type {
  NormalizedEvent,
  Task,
  TaskProjection,
  Project,
  UncertainInput,
} from "@workbench/shared";

export class WorkbenchDatabase {
  private db: DatabaseSync;
  private readonly contentDir: string;
  readonly recoveryReason: string | null = null;

  constructor(dbPath: string) {
    // Ensure parent dir exists
    const parent = dirname(dbPath);
    this.contentDir = join(parent, 'tool-output');
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

    try {
      const check = this.db.prepare('PRAGMA integrity_check').get();
      if (!check || Object.values(check)[0] !== 'ok') throw new Error('数据库一致性检查失败');
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
      if (version > 1) throw new Error(`不支持的数据库版本：${version}`);
      if (version < 1 && this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get()) {
        const backup = join(parent, `workbench-before-migration-${randomUUID()}.db`);
        // VACUUM INTO 提供一致快照，包含 WAL 中已经提交的数据。
        this.db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
      }
      this.db.exec('BEGIN TRANSACTION');
      this.initSchema();
      this.db.exec('PRAGMA user_version=1; COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* 尚未开启事务时无需回滚。 */ }
      this.db.close();
      this.db = new DatabaseSync(dbPath, { readOnly: true });
      this.recoveryReason = (error as Error).message;
    }
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
      CREATE TABLE IF NOT EXISTS event_states (
        event_id TEXT PRIMARY KEY REFERENCES events(id),
        execution_state TEXT NOT NULL,
        attention_state TEXT NOT NULL
      );

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
      CREATE TABLE IF NOT EXISTS runtime_sessions (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id),
        thread_id TEXT NOT NULL,
        profile_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inputs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        text TEXT NOT NULL,
        status TEXT NOT NULL,
        turn_id TEXT
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

  appendEvent(event: NormalizedEvent, taskState?: Pick<Task, 'executionState' | 'attentionState'>): boolean {
    event = { ...event, payload: this.boundPayload(event.payload) as Record<string, unknown> };
    this.db.exec("BEGIN TRANSACTION");
    try {
      // 重送不能再次改变状态；同一个 ID 承载不同事件则拒绝，保留故障可见性。
      const previous = this.db.prepare('SELECT * FROM events WHERE id = ?').get(event.id);
      if (previous) {
        if (previous.type !== event.type || previous.task_id !== event.taskId ||
            previous.turn_id !== event.turnId || previous.payload !== JSON.stringify(event.payload)) {
          throw new Error(`事件 ID 冲突：${event.id}`);
        }
        this.db.exec('COMMIT');
        return false;
      }
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

      if (taskState) this.db.prepare('INSERT INTO event_states (event_id, execution_state, attention_state) VALUES (?, ?, ?)')
        .run(event.id, taskState.executionState, taskState.attentionState);

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
      return true;
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw err;
    }
  }

  getEvents(taskId: string): NormalizedEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE task_id = ? ORDER BY rowid ASC")
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

  private boundPayload(value: unknown): unknown {
    if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > 65536) {
      const content = Buffer.from(value, 'utf8');
      const name = `${createHash('sha256').update(content).digest('hex')}.txt`;
      mkdirSync(this.contentDir, { recursive: true });
      const file = join(this.contentDir, name);
      // 文件有硬上限；Event 不携带原始输出，Renderer 无法误加载整个大文件。
      if (!existsSync(file)) writeFileSync(file, content.subarray(Math.max(0, content.length - 64 * 1024 * 1024)));
      return { ref: `tool-output/${name}`, bytes: content.length, truncated: content.length > 64 * 1024 * 1024,
        tail: value.slice(-65536).split('\n').slice(-200).join('\n') };
    }
    if (Array.isArray(value)) return value.map(item => this.boundPayload(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.boundPayload(item)]));
    return value;
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

  rebuildProjections(): void {
    this.db.exec('BEGIN TRANSACTION');
    try {
      this.db.exec('DELETE FROM projections');
      for (const task of this.listTasks()) {
        const events = this.getEvents(task.id);
        const last = events.at(-1);
        if (!last) continue;
        this.db.prepare('INSERT INTO projections (task_id, status, timeline_summary, last_event_at) VALUES (?, ?, ?, ?)')
          .run(task.id, last.type, JSON.stringify(events.map(event => `${event.type} @ ${event.timestamp}`)), last.timestamp);
        const state = this.db.prepare('SELECT s.* FROM event_states s JOIN events e ON e.id = s.event_id WHERE e.task_id = ? ORDER BY e.rowid DESC LIMIT 1').get(task.id);
        if (state) this.updateTaskStates(task.id, String(state.execution_state), String(state.attention_state));
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  recoverNonTerminalTasks(): void {
    this.db.exec("UPDATE inputs SET status = 'UNCERTAIN' WHERE status = 'SENT'");
    for (const task of this.listTasks()) {
      if (task.executionState !== 'RUNNING' && task.executionState !== 'RECOVERING') continue;
      this.appendEvent({
        id: randomUUID(), type: 'TurnInterrupted', taskId: task.id,
        turnId: null, payload: { reason: 'unclean-manager-exit' },
        timestamp: new Date().toISOString(),
      }, { executionState: 'INTERRUPTED', attentionState: 'UNCERTAIN' });
    }
  }

  saveRuntimeSession(taskId: string, threadId: string, profileId: string): void {
    this.db.prepare('INSERT OR REPLACE INTO runtime_sessions (task_id, thread_id, profile_id) VALUES (?, ?, ?)')
      .run(taskId, threadId, profileId);
  }

  getRuntimeSession(taskId: string): { threadId: string; profileId: string } | null {
    const row = this.db.prepare('SELECT thread_id, profile_id FROM runtime_sessions WHERE task_id = ?').get(taskId);
    return row ? { threadId: String(row.thread_id), profileId: String(row.profile_id) } : null;
  }

  recordInput(taskId: string, text: string): UncertainInput {
    const input: UncertainInput = { id: randomUUID(), taskId, text, status: 'SENT' };
    this.db.prepare('INSERT INTO inputs (id, task_id, text, status) VALUES (?, ?, ?, ?)')
      .run(input.id, taskId, text, input.status);
    return input;
  }

  listUncertainInputs(): UncertainInput[] {
    return this.db.prepare("SELECT * FROM inputs WHERE status = 'UNCERTAIN' ORDER BY rowid").all()
      .map(row => ({ id: String(row.id), taskId: String(row.task_id), text: String(row.text), status: 'UNCERTAIN' }));
  }

  resolveInput(id: string, action: 'resend' | 'discard'): UncertainInput {
    const row = this.db.prepare("UPDATE inputs SET status = ? WHERE id = ? AND status = 'UNCERTAIN' RETURNING *")
      .get(action === 'resend' ? 'SENT' : 'DISCARDED', id);
    if (!row) throw new Error('输入不存在或已处理');
    return { id, taskId: String(row.task_id), text: String(row.text), status: row.status as UncertainInput['status'] };
  }

  markInputUncertain(id: string): void {
    this.db.prepare("UPDATE inputs SET status = 'UNCERTAIN' WHERE id = ? AND status = 'SENT'").run(id);
  }

  bindInputTurn(id: string, turnId: string): void {
    this.db.prepare('UPDATE inputs SET turn_id = ? WHERE id = ?').run(turnId, id);
  }

  confirmTurnInputs(taskId: string, turnId: string): void {
    this.db.prepare("UPDATE inputs SET status = 'CONFIRMED' WHERE task_id = ? AND turn_id = ? AND status = 'SENT'").run(taskId, turnId);
  }

  getAllEvents(): NormalizedEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM events ORDER BY rowid ASC")
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
