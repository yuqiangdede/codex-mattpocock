/**
 * Event 与 Artifact 不一致故障注入：
 *   期望结果 — 显式协调或 UNCERTAIN。
 *
 * 策略：在 Storage 层构造 Event 与 Projection/Task 状态不一致的场景，
 *   验证 rebuildProjections 和 recoverNonTerminalTasks 能检测不一致
 *   并将受影响 Task 标记为 INTERRUPTED + UNCERTAIN。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { WorkbenchDatabase } from '../../packages/storage/dist/index.js';

const cache = resolve('cache');
mkdirSync(cache, { recursive: true });

const tmpDir = mkdtempSync(join(cache, 'event-artifact-mismatch-'));
const dbFile = join(tmpDir, 'workbench.db');
const db = new WorkbenchDatabase(dbFile);

try {
  db.insertProject({ id: 'proj', name: 'mismatch-test', path: '.', toolchain: [], createdAt: '2026-09-06' });
  db.insertTask({ id: 'task-1', projectId: 'proj', prompt: 'Task 1', lifecycle: 'OPEN', executionState: 'IDLE', attentionState: 'NONE', worktreePath: null, worktreeBranch: null, createdAt: '2026-09-06' });
  db.insertTask({ id: 'task-2', projectId: 'proj', prompt: 'Task 2', lifecycle: 'OPEN', executionState: 'IDLE', attentionState: 'NONE', worktreePath: null, worktreeBranch: null, createdAt: '2026-09-06' });
  db.insertTask({ id: 'task-3', projectId: 'proj', prompt: 'Task 3', lifecycle: 'OPEN', executionState: 'IDLE', attentionState: 'NONE', worktreePath: null, worktreeBranch: null, createdAt: '2026-09-06' });

  // ── 1. Event 记录 TurnCompleted 但 Task 仍为 RUNNING ──────────
  db.appendEvent({
    id: 'evt-complete-1', type: 'TurnStarted', taskId: 'task-1', turnId: 'turn-1',
    payload: { turnId: 'turn-1' }, timestamp: '2026-09-06T10:00:00Z',
  }, { executionState: 'RUNNING', attentionState: 'NONE' });

  db.appendEvent({
    id: 'evt-complete-2', type: 'TurnCompleted', taskId: 'task-1', turnId: 'turn-1',
    payload: { turnId: 'turn-1', result: 'success' }, timestamp: '2026-09-06T10:01:00Z',
  });
  db.updateTaskStates('task-1', 'RUNNING', 'NONE');

  db.rebuildProjections();
  const proj1 = db.getProjection('task-1');
  assert.ok(proj1, 'Projection 应存在');
  assert.equal(proj1.status, 'TurnCompleted', 'Projection 最后状态应为 TurnCompleted');
  console.log('PASS: Event 与 Task 状态不一致时 rebuildProjections 从事件重建 Projection');

  // ── 2. recoverNonTerminalTasks 将 RUNNING 任务标记为 INTERRUPTED + UNCERTAIN
  db.updateTaskStates('task-1', 'RUNNING', 'NONE');
  db.recoverNonTerminalTasks();
  const recovered1 = db.getTask('task-1');
  assert.equal(recovered1.executionState, 'INTERRUPTED');
  assert.equal(recovered1.attentionState, 'UNCERTAIN');
  console.log('PASS: RUNNING Task 恢复后标记为 INTERRUPTED + UNCERTAIN');

  // ── 3. Task 为 RUNNING 但没有 TurnStarted Event（状态与事件分离）────
  db.updateTaskStates('task-2', 'RUNNING', 'NONE');
  db.recoverNonTerminalTasks();
  const recovered2 = db.getTask('task-2');
  assert.equal(recovered2.executionState, 'INTERRUPTED');
  assert.equal(recovered2.attentionState, 'UNCERTAIN');
  const events2 = db.getEvents('task-2');
  assert.ok(events2.some(e => e.type === 'TurnInterrupted'), '应有 TurnInterrupted 事件');
  console.log('PASS: 状态与事件分离时 recoverNonTerminalTasks 插入 TurnInterrupted 并标记 UNCERTAIN');

  // ── 4. Projection 缺失但 Event 存在 ────────────────────────────
  db.appendEvent({
    id: 'evt-orphan-1', type: 'TaskCreated', taskId: 'task-3', turnId: null,
    payload: { taskId: 'task-3' }, timestamp: '2026-09-06T11:00:00Z',
  });
  db.rebuildProjections();
  const proj3 = db.getProjection('task-3');
  assert.ok(proj3, '重建后 Projection 应存在');
  assert.equal(proj3.status, 'TaskCreated');
  console.log('PASS: Projection 缺失时 rebuildProjections 从 Event 重建');

  // ── 5. 不一致后需要显式协调（不自动恢复）──────────────────────
  const stillInterrupted = db.getTask('task-2');
  assert.equal(stillInterrupted.executionState, 'INTERRUPTED', '恢复后仍为 INTERRUPTED，不自动恢复为 RUNNING');
  console.log('PASS: 不一致后需显式协调，不自动恢复为 RUNNING');

  // ── 6. 重复恢复不产生重复事件（幂等）──────────────────────────
  const eventsBefore = db.getEvents('task-2').length;
  db.recoverNonTerminalTasks();
  const eventsAfter = db.getEvents('task-2').length;
  assert.equal(eventsAfter, eventsBefore, '已恢复的 Task 不会重复插入 TurnInterrupted');
  console.log('PASS: 重复恢复幂等，不产生重复事件');
} finally {
  db.close();
}
