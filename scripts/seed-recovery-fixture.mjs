import { WorkbenchDatabase } from '../packages/storage/dist/index.js';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

// 仅构造持久化崩溃现场；不声称执行过模型 Turn。只调用 Storage 公开接口。
const dataDir = process.argv[2];
if (!dataDir) throw new Error('缺少独立 fixture 数据目录');
const db = new WorkbenchDatabase(join(dataDir, 'workbench.db'));
const timestamp = new Date().toISOString();
try {
  db.insertProject({ id: 'recovery-project', name: '崩溃现场', path: dataDir, toolchain: [], createdAt: timestamp });
  db.insertTask({ id: 'recovery-task', projectId: 'recovery-project', prompt: '恢复未确认输入', lifecycle: 'OPEN', executionState: 'IDLE', attentionState: 'NONE', worktreePath: null, worktreeBranch: null, createdAt: timestamp });
  db.appendEvent({ id: 'recovery-event', type: 'TurnStarted', taskId: 'recovery-task', turnId: 'fixture-turn', payload: { fixture: true }, timestamp }, { executionState: 'RUNNING', attentionState: 'NONE' });
  const input = db.recordInput('recovery-task', '未经确认不得自动重放');
  writeFileSync(join(dataDir, 'fixture.json'), JSON.stringify({ taskId: 'recovery-task', inputId: input.id, eventId: 'recovery-event' }), 'utf8');
} finally { db.close(); }
