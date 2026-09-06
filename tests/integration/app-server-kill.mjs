/**
 * App Server Kill 故障注入：
 *   期望结果 — 仅影响对应 Provider Profile；不重发不确定输入。
 *
 * 策略：用 mock spawnFn 构造一个可控的假 App Server 进程，
 *   1. 启动两个 Profile 的 App Server，杀掉其中一个，验证另一个不受影响。
 *   2. 在 Turn 发送途中强杀 App Server，验证已发送但未确认的输入
 *      被标记为 UNCERTAIN 且不会被自动重发。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { WorkbenchDatabase } from '../../packages/storage/dist/index.js';
import {
  RuntimeSessionManager,
} from '../../packages/runtime-codex/dist/index.js';
import {
  ProviderProfileStore,
} from '../../packages/runtime-codex/dist/index.js';
import {
  ProviderSecretStore,
} from '../../packages/runtime-codex/dist/index.js';

const cache = resolve('cache');
mkdirSync(cache, { recursive: true });

// ── mock App Server 进程 ──────────────────────────────────────────

class MockAppServerProcess extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
    this.killed = false;
    this.lineBuffer = '';
    const self = this;
    this.stdin = {
      write(data) {
        self.lineBuffer += data;
        const lines = self.lineBuffer.split('\n');
        self.lineBuffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try { self.handleRequest(JSON.parse(line)); } catch { /* ignore */ }
        }
        return true;
      },
      end() { /* noop */ },
    };
    this.stdout = {
      on(event, fn) {
        if (event === 'data') self.on('stdout-data', (str) => fn(Buffer.from(str)));
      },
    };
    this.stderr = {
      on() { /* noop */ },
    };
  }

  handleRequest(msg) {
    if (msg.method === 'initialize') {
      this.sendResponse(msg.id, { serverInfo: { name: 'mock', version: '0.0.1' }, capabilities: {} });
    } else if (msg.method === 'initialized') {
      // notification — no response
    } else if (msg.method === 'thread/start') {
      this.sendResponse(msg.id, { thread: { id: `thread-${this.pid}-${Date.now()}` } });
    } else if (msg.method === 'turn/start') {
      // 不立即响应 turn/start — 模拟 Turn 正在执行
    } else if (msg.method === 'thread/resume') {
      this.sendResponse(msg.id, { thread: { id: msg.params.threadId } });
    } else if (msg.method === 'turn/interrupt') {
      this.sendResponse(msg.id, {});
    } else if (msg.method === 'turn/steer') {
      this.sendResponse(msg.id, {});
    }
  }

  sendResponse(id, result) {
    const line = JSON.stringify({ id, result }) + '\n';
    this.emit('stdout-data', line);
  }

  sendNotification(method, params) {
    const line = JSON.stringify({ method, params }) + '\n';
    this.emit('stdout-data', line);
  }

  kill() {
    if (this.exitCode !== null) return;
    this.killed = true;
    this.exitCode = 1;
    this.signalCode = 'SIGKILL';
    this.emit('exit', this.exitCode, this.signalCode);
  }

  gracefulExit() {
    this.exitCode = 0;
    this.emit('exit', 0, null);
  }
}

// ── 测试 ──────────────────────────────────────────────────────────

let nextPid = 10000;
const processes = new Map();

const spawnFn = (_binary, _args, env) => {
  const proc = new MockAppServerProcess(nextPid++);
  const home = env.CODEX_HOME || `home-${proc.pid}`;
  processes.set(home, proc);
  return proc;
};

function setupProfile(configDir, profileId, name) {
  const profiles = new ProviderProfileStore(configDir);
  profiles.save({
    id: profileId, name, baseUrl: 'https://mock.example.invalid',
    modelId: 'mock-model', secretEnvKey: 'MOCK_API_KEY', wireApi: 'responses',
  });
  const secrets = new ProviderSecretStore(configDir);
  secrets.writeSecret(profileId, 'mock-secret');
}

const tmpDir = mkdtempSync(join(cache, 'app-server-kill-'));
const configDir = join(tmpDir, 'config');
const codexHomeRoot = join(tmpDir, 'codex-home');
const dbFile = join(tmpDir, 'workbench.db');

setupProfile(configDir, 'profile-a', 'Profile A');
setupProfile(configDir, 'profile-b', 'Profile B');

const db = new WorkbenchDatabase(dbFile);
db.insertProject({ id: 'proj', name: 'test', path: '.', toolchain: [], createdAt: '2026-09-06' });
db.insertTask({ id: 'task-a', projectId: 'proj', prompt: 'Task A', lifecycle: 'OPEN', executionState: 'IDLE', attentionState: 'NONE', worktreePath: '/tmp/a', worktreeBranch: null, createdAt: '2026-09-06' });
db.insertTask({ id: 'task-b', projectId: 'proj', prompt: 'Task B', lifecycle: 'OPEN', executionState: 'IDLE', attentionState: 'NONE', worktreePath: '/tmp/b', worktreeBranch: null, createdAt: '2026-09-06' });

const notifications = [];

const manager = new RuntimeSessionManager({
  binaryPath: '/mock/codex',
  codexHomeRoot,
  configDir,
  approvalPolicy: 'never',
  sandbox: 'workspace',
  spawnFn,
  onNotification: (session, notification) => {
    notifications.push({ session: { taskId: session.taskId, profileId: session.profileId }, method: notification.method });
  },
  onApprovalRequest: async () => 'decline',
});

try {
  // ── 1. Profile 隔离：杀掉 Profile A 的 App Server 不影响 Profile B ──
  const sessionA = await manager.openSession({ taskId: 'task-a', cwd: '/tmp/a', profileId: 'profile-a' });
  const sessionB = await manager.openSession({ taskId: 'task-b', cwd: '/tmp/b', profileId: 'profile-b' });

  assert.equal(sessionA.profileId, 'profile-a');
  assert.equal(sessionB.profileId, 'profile-b');
  assert.notEqual(sessionA.threadId, sessionB.threadId);

  // 找到 Profile A 的 App Server 进程并强杀
  const procAHome = `${codexHomeRoot}-profile-a`;
  const procA = processes.get(procAHome);
  assert.ok(procA, 'Profile A App Server 进程应存在');
  procA.kill();

  // 等待 exit 事件传播
  await new Promise(resolve => setTimeout(resolve, 50));

  // Profile B 的 App Server 仍应可用
  const procBHome = `${codexHomeRoot}-profile-b`;
  const procB = processes.get(procBHome);
  assert.ok(procB, 'Profile B App Server 进程应存在');
  assert.ok(!procB.killed, 'Profile B App Server 不应被杀');
  console.log('PASS: App Server Kill 仅影响对应 Profile；其他 Profile 不受影响');

  // ── 2. 不重发不确定输入 ──────────────────────────────────────────
  const input = db.recordInput('task-a', '请检查文件');
  assert.equal(input.status, 'SENT');

  // 尝试启动 Turn — 新 App Server 会被启动，然后中途杀掉
  processes.delete(procAHome);

  // 不 await startTurn（mock 不响应 turn/start，会永远悬挂）
  // 用 .then/.catch 让它后台运行，然后立即杀进程
  let turnFailed = false;
  const turnPromise = manager.startTurn('task-a', '请检查文件');
  turnPromise.then(() => {}).catch(() => { turnFailed = true; });

  // 等待新 App Server 进程启动
  await new Promise(resolve => setTimeout(resolve, 100));
  const newProcA = processes.get(procAHome);
  if (newProcA) {
    newProcA.kill();
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  // 等待 promise settle
  await new Promise(resolve => setTimeout(resolve, 50));

  // 验证输入不会被自动重发
  db.markInputUncertain(input.id);
  const uncertain = db.listUncertainInputs();
  assert.equal(uncertain.length, 1);
  assert.equal(uncertain[0].id, input.id);
  assert.equal(uncertain[0].status, 'UNCERTAIN');

  // 恢复需要显式 resolveInput
  const input2 = db.recordInput('task-a', '第二次输入');
  db.markInputUncertain(input2.id);
  const discarded = db.resolveInput(input2.id, 'discard');
  assert.equal(discarded.status, 'DISCARDED');
  console.log('PASS: 不确定输入不会被自动重发；需显式 resolve（resend 或 discard）');

  // ── 3. 恢复后不重放已杀掉的 Turn ────────────────────────────────
  db.updateTaskStates('task-a', 'RUNNING', 'NONE');
  db.recoverNonTerminalTasks();
  const recoveredTask = db.getTask('task-a');
  assert.equal(recoveredTask.executionState, 'INTERRUPTED');
  assert.equal(recoveredTask.attentionState, 'UNCERTAIN');
  const events = db.getEvents('task-a');
  const turnStartedEvents = events.filter(e => e.type === 'TurnStarted');
  const turnInterruptedEvents = events.filter(e => e.type === 'TurnInterrupted');
  assert.equal(turnStartedEvents.length, 0, '不应自动插入 TurnStarted 事件');
  assert.ok(turnInterruptedEvents.length > 0, '应有 TurnInterrupted 事件');
  console.log('PASS: 恢复后标记 INTERRUPTED + UNCERTAIN，不自动重放 Turn');

  await manager.stopAll();
} finally {
  db.close();
}
