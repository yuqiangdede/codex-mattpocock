import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { WorkbenchDatabase } from '../../packages/storage/dist/index.js';

const root = resolve(import.meta.dirname, '../..');
mkdirSync(join(root, 'cache'), { recursive: true });
const db = new WorkbenchDatabase(join(mkdtempSync(join(root, 'cache/interrupt-test-')), 'workbench.db'));
try {
  db.insertProject({ id: 'project', name: 'fixture', path: '.', toolchain: [], createdAt: '2026-09-05T00:00:00Z' });
  db.insertTask({ id: 'task', projectId: 'project', prompt: '中断回滚验证', lifecycle: 'OPEN', executionState: 'RUNNING', attentionState: 'NONE', worktreePath: null, worktreeBranch: null, createdAt: '2026-09-05T00:00:00Z' });
  const event = { id: 'event', type: 'TurnStarted', taskId: 'task', turnId: 'turn', payload: {}, timestamp: '2026-09-05T00:00:00Z' };
  db.appendEvent(event);
  // 相同 ID 携带不同事件仍须拒绝；精确重送现在属于幂等成功。
  assert.throws(() => db.appendEvent({ ...event, type: 'TurnInterrupted' }, { executionState: 'INTERRUPTED', attentionState: 'UNCERTAIN' }), /冲突/);
  assert.equal(db.getTask('task').executionState, 'RUNNING');
  assert.equal(db.getEvents('task').length, 1);
  assert.equal(db.getProjection('task').status, 'TurnStarted');
  db.appendEvent({ ...event, id: 'interrupted', type: 'TurnInterrupted' }, { executionState: 'INTERRUPTED', attentionState: 'UNCERTAIN' });
  assert.equal(db.getTask('task').executionState, 'INTERRUPTED');
  assert.equal(db.getTask('task').attentionState, 'UNCERTAIN');
  assert.equal(db.getEvents('task').length, 2);
  assert.equal(db.getProjection('task').status, 'TurnInterrupted');
  console.log('PASS: 中断状态与事件同事务提交；事件失败时状态和 Projection 回滚');
} finally { db.close(); }
