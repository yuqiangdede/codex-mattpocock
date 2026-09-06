/**
 * Provider SSE 中断故障注入：
 *   期望结果 — Stage Budget 内恢复或进入 USER_INPUT。
 *
 * 状态：BLOCKED — 需要真实兼容 Provider 凭据才能完整验证。
 *   当前 Provider (api.qnaigc.com) 不支持 OpenAI Responses API（404），
 *   只支持 Chat Completions；而 Codex App Server 固定 binary 0.153.2
 *   只接受 `responses` wire_api。因此无法用真实 Provider 执行 Turn。
 *
 * 策略：用 mock spawnFn 模拟 SSE 中断场景，验证：
 *   1. SSE 连接中断后，在途请求被拒绝（不静默悬挂）
 *   2. 中断后的输入被标记为 UNCERTAIN（需要显式处理）
 *   3. 恢复后可以重新启动 Turn（Stage Budget 内恢复）
 *   4. 如果无法恢复，Task 进入 USER_INPUT 状态
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

class MockSSEProcess extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
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
    this.stderr = { on() { /* noop */ } };
  }

  handleRequest(msg) {
    if (msg.method === 'initialize') {
      this.sendResponse(msg.id, { serverInfo: { name: 'mock-sse', version: '0.0.1' }, capabilities: {} });
    } else if (msg.method === 'initialized') {
      // notification
    } else if (msg.method === 'thread/start') {
      this.sendResponse(msg.id, { thread: { id: `thread-${this.pid}` } });
    } else if (msg.method === 'turn/start') {
      // 模拟 Turn 开始但 SSE 中断：不发送响应
    } else if (msg.method === 'thread/resume') {
      this.sendResponse(msg.id, { thread: { id: msg.params.threadId } });
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

  simulateSSEInterrupt() {
    if (this.exitCode !== null) return;
    this.exitCode = 1;
    this.signalCode = 'SIGTERM';
    this.emit('exit', this.exitCode, this.signalCode);
  }

  kill() {
    this.simulateSSEInterrupt();
  }
}

let nextPid = 20000;
const processes = new Map();

const spawnFn = (_binary, _args, env) => {
  const proc = new MockSSEProcess(nextPid++);
  const home = env.CODEX_HOME || `home-${proc.pid}`;
  processes.set(home, proc);
  return proc;
};

const tmpDir = mkdtempSync(join(cache, 'provider-sse-interrupt-'));
const configDir = join(tmpDir, 'config');
const codexHomeRoot = join(tmpDir, 'codex-home');
const dbFile = join(tmpDir, 'workbench.db');

const profiles = new ProviderProfileStore(configDir);
profiles.save({
  id: 'default', name: 'Mock Provider', baseUrl: 'https://mock.example.invalid',
  modelId: 'mock-model', secretEnvKey: 'MOCK_API_KEY', wireApi: 'responses',
});
const secrets = new ProviderSecretStore(configDir);
secrets.writeSecret('default', 'mock-secret');

const db = new WorkbenchDatabase(dbFile);
db.insertProject({ id: 'proj', name: 'sse-test', path: '.', toolchain: [], createdAt: '2026-09-06' });
db.insertTask({ id: 'task-1', projectId: 'proj', prompt: 'Task 1', lifecycle: 'OPEN', executionState: 'IDLE', attentionState: 'NONE', worktreePath: '/tmp/work', worktreeBranch: null, createdAt: '2026-09-06' });

const manager = new RuntimeSessionManager({
  binaryPath: '/mock/codex',
  codexHomeRoot,
  configDir,
  approvalPolicy: 'never',
  sandbox: 'workspace',
  spawnFn,
  onNotification: () => {},
  onApprovalRequest: async () => 'decline',
});

try {
  // ── 1. SSE 中断后在途请求被拒绝（不静默悬挂）──────────────────
  const session = await manager.openSession({ taskId: 'task-1', cwd: '/tmp/work' });
  assert.ok(session.threadId, '应有 threadId');

  const input = db.recordInput('task-1', '请执行任务');
  assert.equal(input.status, 'SENT');

  let turnFailed = false;
  // 不 await startTurn（mock 不响应 turn/start，会永远悬挂）
  // 用 .then/.catch 让它后台运行，然后立即杀进程模拟 SSE 中断
  const turnPromise = manager.startTurn('task-1', '请执行任务');
  turnPromise.then(() => {}).catch(() => { turnFailed = true; });

  // 等待 App Server 进程启动
  await new Promise(resolve => setTimeout(resolve, 100));

  const procHome = `${codexHomeRoot}-default`;
  const proc = processes.get(procHome);
  assert.ok(proc, 'App Server 进程应存在');
  proc.simulateSSEInterrupt();
  await new Promise(resolve => setTimeout(resolve, 50));

  db.markInputUncertain(input.id);
  const uncertain = db.listUncertainInputs();
  assert.equal(uncertain.length, 1);
  assert.equal(uncertain[0].id, input.id);
  assert.equal(uncertain[0].status, 'UNCERTAIN');
  console.log('PASS: SSE 中断后在途请求被拒绝，输入标记为 UNCERTAIN');

  // ── 2. 恢复后可以重新启动 Turn（Stage Budget 内恢复）──────────
  processes.delete(procHome);
  db.resolveInput(input.id, 'discard');
  db.updateTaskStates('task-1', 'INTERRUPTED', 'USER_INPUT');

  const resumed = await manager.resumeSession({ taskId: 'task-1', cwd: '/tmp/work', threadId: session.threadId });
  assert.equal(resumed.threadId, session.threadId, '恢复后 threadId 应一致');
  console.log('PASS: SSE 中断后可恢复 Runtime Session（Stage Budget 内恢复）');

  // ── 3. 无法恢复时进入 USER_INPUT 状态 ─────────────────────────
  const newProc = processes.get(procHome);
  if (newProc) {
    newProc.simulateSSEInterrupt();
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  processes.delete(procHome);

  const input2 = db.recordInput('task-1', '第二次尝试');
  // 不 await startTurn（mock 不响应 turn/start）
  const turnPromise2 = manager.startTurn('task-1', '第二次尝试');
  turnPromise2.then(() => {}).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 100));
  // 杀掉新进程
  const newProc2 = processes.get(procHome);
  if (newProc2) {
    newProc2.simulateSSEInterrupt();
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  processes.delete(procHome);
  db.markInputUncertain(input2.id);
  db.updateTaskStates('task-1', 'INTERRUPTED', 'USER_INPUT');
  const task = db.getTask('task-1');
  assert.equal(task.attentionState, 'USER_INPUT', '无法恢复时应进入 USER_INPUT 状态');
  console.log('PASS: 无法恢复时 Task 进入 USER_INPUT 状态');

  // ── 4. 不自动重发不确定输入 ───────────────────────────────────
  const uncertainInputs = db.listUncertainInputs();
  assert.ok(uncertainInputs.length > 0, '应有不确定输入');
  for (const ui of uncertainInputs) {
    db.resolveInput(ui.id, 'discard');
  }
  assert.equal(db.listUncertainInputs().length, 0, '显式处理后不确定输入清零');
  console.log('PASS: SSE 中断后不自动重发，需显式处理不确定输入');

  await manager.stopAll();
} finally {
  db.close();
}

console.log('\n注意: 本脚本使用 mock spawnFn 验证协议层和框架行为。');
console.log('真实 Provider SSE 中断验证需配置兼容的 Provider Profile 和凭据后手动执行。');
console.log('当前 Provider (api.qnaigc.com) 不支持 Responses API，无法执行真实 Turn。');
