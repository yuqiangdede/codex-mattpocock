import assert from 'node:assert/strict';
import { build } from 'vite';
import { builtinModules, createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

// 明确测试替身边界：Runtime port 注入故障与通知；Storage、Git worktree 和 service request 均真实。
// 本套件不启动模型进程，不能作为 Provider 或真实活动 Turn 验收。
const root = resolve(import.meta.dirname, '..');
mkdirSync(join(root, 'cache'), { recursive: true });
const scratch = mkdtempSync(join(root, 'cache/service-runtime-port-'));
const aliases = Object.fromEntries(['shared', 'storage', 'git-worktree', 'protocol', 'runtime-codex'].map(name => [`@workbench/${name}`, join(root, `packages/${name}/src/index.ts`)]));
await build({ configFile: false, logLevel: 'error', resolve: { alias: aliases }, build: { emptyOutDir: false, outDir: join(scratch, 'bundle'), lib: { entry: join(root, 'packages/agent-manager/src/service.ts'), formats: ['cjs'], fileName: () => 'service.cjs' }, rollupOptions: { external: ['node:sqlite', ...builtinModules, ...builtinModules.map(name => `node:${name}`)] } } });
const { AgentManagerService } = createRequire(import.meta.url)(join(scratch, 'bundle/service.cjs'));
const repo = join(scratch, 'repo');
mkdirSync(repo);
writeFileSync(join(repo, 'fixture.txt'), 'fixture\n', 'utf8');
for (const args of [['init', '-b', 'main'], ['add', 'fixture.txt'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']]) execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
const dataDir = join(scratch, 'data');
let callbacks;
let calls = 0;
let session;
let behavior;
const runtime = {
  setCallbacks(value) { callbacks = value; },
  getSession() { return session; },
  async openSession({ taskId }) { session = { taskId, threadId: 'test-thread', profileId: 'test-profile', activeTurnId: null }; return session; },
  async startTurn(taskId, text) {
    calls++;
    // 读取已经落盘的数据库文件确认时序，不访问 service 私有成员。
    const disk = new DatabaseSync(join(dataDir, 'workbench.db'), { readOnly: true });
    try { assert.equal(disk.prepare("SELECT COUNT(*) AS count FROM inputs WHERE task_id = ? AND text = ? AND status = 'SENT'").get(taskId, text).count, 1, 'Runtime 收到输入前必须已落盘且单次 claim'); }
    finally { disk.close(); }
    return behavior();
  },
  async stopAll() {},
};
let service = new AgentManagerService({ dataDir, runtime, notify: () => {} });
service.wireRuntimeCallbacks();
const value = async (channel, args = []) => { const result = await service.request(channel, args); assert.equal(result.ok, true, result.error); return result.data; };
try {
  const project = await value('project:scan', [repo]);
  const task = await value('task:create', [project.id, '输入不确定性验证']);
  await value('worktree:create', [task.id]);
  behavior = () => { throw new Error('注入：发出后连接断开'); };
  const failed = await service.request('turn:start', [task.id]);
  assert.equal(failed.ok, false);
  assert.match(failed.error, /连接断开/);
  let recovery = await value('recovery:load');
  const input = recovery.uncertainInputs[0];
  assert.equal(recovery.uncertainInputs.length, 1);
  assert.equal(input.text, task.prompt);
  assert.equal(recovery.tasks[0].executionState, 'INTERRUPTED');
  assert.equal((await service.request('turn:start', [task.id])).ok, false, '存在不确定输入时不能盲目启动新 Turn');
  assert.equal(calls, 1);
  let rejectSend;
  behavior = () => new Promise((_, reject) => { rejectSend = reject; });
  const resend = service.request('input:resolve', [input.id, 'resend']);
  await Promise.resolve();
  assert.equal((await service.request('input:resolve', [input.id, 'resend'])).ok, false, '并发重发同一输入只能认领一次');
  assert.equal(calls, 2);
  rejectSend(new Error('注入：重发后再次断开'));
  assert.equal((await resend).ok, false);
  assert.deepEqual((await value('recovery:load')).uncertainInputs, [input]);
  await value('input:resolve', [input.id, 'discard']);
  assert.deepEqual((await value('recovery:load')).uncertainInputs, []);
  console.log('PASS: Runtime port 注入下先落盘再发送、失败不确定、单次重发认领、失败保留原输入及丢弃');

  const notify = (method, turn) => callbacks.onNotification(session, { method, params: { threadId: session.threadId, turn } });
  behavior = async () => {
    session.activeTurnId = 'race-turn';
    notify('turn/started', { id: 'race-turn' });
    notify('turn/started', { id: 'race-turn' });
    notify('turn/completed', { id: 'race-turn', status: 'completed' });
    notify('turn/completed', { id: 'race-turn', status: 'completed' });
    return 'race-turn';
  };
  await value('turn:start', [task.id]);
  recovery = await value('recovery:load');
  assert.equal(recovery.tasks[0].executionState, 'IDLE', '完成通知先于 ACK 时不得回退 RUNNING');
  assert.equal(recovery.events.filter(event => event.type === 'TurnStarted' && event.turnId === 'race-turn').length, 1);
  assert.equal(recovery.events.filter(event => event.type === 'TurnCompleted' && event.turnId === 'race-turn').length, 1);
  assert.deepEqual(recovery.uncertainInputs, []);
  await service.close();
  service = new AgentManagerService({ dataDir, notify: () => {} });
  assert.deepEqual((await value('recovery:load')).uncertainInputs, [], '已完成输入与丢弃输入在重开后不再出现');
  console.log('PASS: Runtime port 重复 started/completed 幂等，完成通知早于 ACK 不回退状态；重开不重放输入');
} finally { await service.close(); }
