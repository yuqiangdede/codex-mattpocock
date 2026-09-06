const { app, BrowserWindow, utilityProcess } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');

// 测试仅使用 Main 的公开客户端；数据库与业务处理必须在真实子进程内执行。
const root = path.resolve(__dirname, '../..');
const testRoot = fs.mkdtempSync(path.join(root, 'cache/manager-test-'));
app.setPath('userData', path.join(testRoot, 'electron'));
let manager;
let window;
let rawChild;
let parent;
let orphanPid;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(predicate, message) {
  const deadline = Date.now() + 8000;
  while (!predicate()) { if (Date.now() >= deadline) throw new Error(message); await delay(50); }
}
app.whenReady().then(async () => {
  const { AgentManagerClient, registerManagerIpc } = require('../../out/main/manager-bridge.js');
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'apps/desktop/main/src/index.ts'), 'utf8'), /@workbench\/(storage|git-worktree)/, 'Main 不得持有数据库或 Git 业务依赖');
  const notifications = [];
  manager = new AgentManagerClient({
    entry: path.join(root, 'out/main/agent-manager.js'),
    dataDir: path.join(testRoot, 'data'),
    onNotification: (channel, payload) => {
      notifications.push({ channel, payload });
      if (window && !window.isDestroyed() && !window.webContents.isCrashed()) window.webContents.send(channel, payload);
    },
    onFailure: (message) => console.error(message),
  });
  await manager.ready;
  assert.ok(manager.pid && manager.pid !== process.pid, '数据库服务必须运行在独立进程');
  const project = await manager.request('project:scan', [root]);
  assert.equal(project.ok, true, project.error);
  const listed = await manager.request('project:list', []);
  assert.equal(listed.data[0].id, project.data.id);
  assert.equal(notifications[0].channel, 'event:stream');
  assert.equal(notifications[0].payload.type, 'ProjectScanned');
  console.log('PASS: 真实 Utility Process 创建、读取 Project 并转发事件');

  const fixture = path.join(testRoot, 'fixture');
  fs.mkdirSync(fixture);
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --experimental-strip-types --test index.test.ts' } }));
  fs.writeFileSync(path.join(fixture, 'index.ts'), '// 待实现\n');
  fs.writeFileSync(path.join(fixture, 'index.test.ts'), "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { hello } from './index.ts'; test('hello 返回预期值', () => assert.equal(hello(), 'hello world'));\n");
  for (const args of [['init', '-b', 'main'], ['add', 'package.json', 'index.ts', 'index.test.ts'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']]) {
    execFileSync('git', args, { cwd: fixture, stdio: 'pipe' });
  }
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(root, 'out/preload/index.js') } });
  registerManagerIpc(manager, () => window);
  await window.loadURL('data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src %27none%27"><title>进程集成验证</title>');
  const api = (method, ...args) => window.webContents.executeJavaScript(`window.workbench[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
  const value = async (method, ...args) => {
    const result = await api(method, ...args);
    assert.equal(result.ok, true, result.error);
    return result.data;
  };
  await window.webContents.executeJavaScript('window.receivedEvents=[]; window.receivedApprovals=[]; window.workbench.onEventStream(e=>window.receivedEvents.push(e)); window.workbench.onApprovalRequest(e=>window.receivedApprovals.push(e));');
  const scanned = await value('scanProject', fixture);
  assert.ok(scanned.toolchain.includes('git'));
  const task = await value('createTask', scanned.id, '实现 hello()');
  assert.equal((await value('getTask', task.id)).prompt, '实现 hello()');
  assert.equal((await value('listTasks', scanned.id)).length, 1);
  const wt = await value('createWorktree', task.id);
  assert.equal(wt.branch, `task/${task.id}`);
  assert.equal((await value('runVerification', task.id)).passed, false);
  const beforeStart = await value('loadRecovery');
  const unavailable = await api('startTurn', task.id);
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.error, /Provider Profile|Runtime Session Manager 未初始化/);
  assert.deepEqual(await value('loadRecovery'), beforeStart, 'Runtime 前置条件失败不得写入虚假活动 Turn');
  const approvals = await window.webContents.executeJavaScript('window.receivedApprovals');
  assert.equal(approvals.length, 0, '未启动真实 Runtime 不得制造审批');
  assert.equal((await value('getTask', task.id)).executionState, 'IDLE');
  // 本地 fixture 修改验证 Git/Verify 的真实跨进程边界，不冒称模型生成代码。
  fs.writeFileSync(path.join(wt.path, 'index.ts'), "export function hello() { return 'hello world'; }\n");
  assert.match((await value('getDiff', task.id)).files[0].patch, /hello world/);
  assert.equal((await value('runVerification', task.id)).passed, true);
  const before = await value('loadRecovery');
  const streamed = await window.webContents.executeJavaScript('window.receivedEvents');
  assert.ok(streamed.some(e => e.type === 'VerificationCompleted' && e.taskId === task.id));
  const loaded = once(window.webContents, 'did-finish-load');
  window.webContents.reload();
  await loaded;
  const after = await value('loadRecovery');
  assert.deepEqual(after, before);
  assert.equal((await api('getTask', 'missing-task')).ok, false);
  assert.equal((await api('decideApproval', 'missing-approval', 'approved')).ok, false);
  assert.equal((await api('createTask', null, 'invalid')).ok, false);
  console.log('PASS: Preload → Main → Utility Process 项目/任务/Git/Verify、重载与 Runtime 未配置错误');
  const crashed = once(window.webContents, 'render-process-gone');
  window.webContents.forcefullyCrashRenderer();
  await crashed;
  const whileDown = await manager.request('task:create', [scanned.id, 'Renderer 崩溃期间仍可持久化']);
  assert.equal(whileDown.ok, true, whileDown.error);
  await window.loadURL('data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src %27none%27"><title>Renderer 恢复验证</title>');
  assert.equal((await value('getTask', whileDown.data.id)).prompt, whileDown.data.prompt);
  assert.deepEqual((await value('loadRecovery')).events.filter(e => e.taskId === task.id), before.events.filter(e => e.taskId === task.id));
  console.log('PASS: 真实 Renderer Kill 后 Manager 继续写入，重载保留原任务事件并加载新增任务');

  // 直接操作真实消息端口，检查 ADR 中请求 ACK 和重复投递语义。
  rawChild = utilityProcess.fork(path.join(root, 'out/main/agent-manager.js'), [path.join(testRoot, 'protocol'), String(process.pid)], { stdio: 'pipe' });
  const received = [];
  rawChild.on('message', message => received.push(message));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('协议进程启动超时')), 5000);
    rawChild.on('message', m => { if (m.kind === 'ready') { clearTimeout(timer); resolve(); } });
  });
  const request = { version: 1, messageId: 1, requestId: 1, kind: 'request', channel: 'project:scan', args: [fixture] };
  rawChild.postMessage(request);
  rawChild.postMessage({ ...request, messageId: 2 });
  rawChild.postMessage({ version: 1, messageId: 3, requestId: 2, kind: 'request', channel: 'project:list', args: [] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('协议请求超时')), 5000);
    rawChild.on('message', m => { if (m.kind === 'response' && m.requestId === 2) { clearTimeout(timer); resolve(); } });
  });
  assert.ok(received.some(m => m.kind === 'ack' && m.requestId === 1));
  assert.equal(received.find(m => m.kind === 'response' && m.requestId === 2).result.data.length, 1, '重复请求不得重复创建 Project');
  console.log('PASS: 请求 ACK 与重复请求去重');
  const rawExit = once(rawChild, 'exit');
  rawChild.postMessage({ version: 1, messageId: 4, requestId: 0, kind: 'shutdown' });
  await rawExit;
  rawChild = null;

  await manager.stop();
  manager = new AgentManagerClient({ entry: path.join(root, 'out/main/agent-manager.js'), dataDir: path.join(testRoot, 'data'), onNotification: () => {}, onFailure: message => console.error(message) });
  await manager.ready;
  const recovered = await manager.request('task:get', [task.id]);
  assert.equal(recovered.data.executionState, 'IDLE', '正常退出后无活动 Turn 的任务应保持 IDLE');
  assert.equal(recovered.data.id, task.id);
  console.log('PASS: 正常退出重开保留真实任务 ID 和状态');

  await manager.stop();
  const failures = [];
  manager = new AgentManagerClient({ entry: path.join(root, 'out/main/agent-manager.js'), dataDir: path.join(testRoot, 'data'), onNotification: () => {}, onFailure: message => failures.push(message) });
  await manager.ready;
  const pending = manager.request('project:list', []);
  process.kill(manager.pid);
  await until(() => failures.length === 1, 'Main 未报告 Agent Manager 崩溃');
  assert.equal((await pending).ok, false);
  assert.equal((await manager.request('project:list', [])).ok, false);
  assert.match(failures[0], /Agent Manager 已退出/);
  console.log('PASS: 杀死 Agent Manager 后 Main 报告错误，待处理及后续请求失败');

  const orphanDir = path.join(testRoot, 'orphan');
  fs.mkdirSync(orphanDir);
  parent = spawn(process.execPath, [path.join(__dirname, 'manager-parent.cjs'), orphanDir], { windowsHide: true, stdio: 'pipe' });
  let parentOutput = '';
  parent.stderr.on('data', data => { parentOutput += data; });
  await until(() => fs.existsSync(path.join(orphanDir, 'ready.json')), '父进程测试启动失败');
  const orphan = JSON.parse(fs.readFileSync(path.join(orphanDir, 'ready.json'), 'utf8'));
  orphanPid = orphan.pid;
  const parentExit = once(parent, 'exit');
  parent.kill();
  await parentExit;
  await until(() => !alive(orphanPid), `Main 被杀死后 Agent Manager 未退出: ${parentOutput}`);
  manager = new AgentManagerClient({ entry: path.join(root, 'out/main/agent-manager.js'), dataDir: orphanDir, onNotification: () => {}, onFailure: console.error });
  await manager.ready;
  const interrupted = (await manager.request('task:get', [orphan.taskId])).data;
  assert.equal(interrupted.id, orphan.taskId);
  assert.equal(interrupted.executionState, 'IDLE');
  assert.equal(interrupted.attentionState, 'NONE');
  console.log('PASS: 强杀 Main 后无遗留 Manager 子进程，重开保留已持久化任务');
  await manager.stop();
  const recoveryDir = path.join(testRoot, 'seeded-recovery');
  assert.ok(process.env.WORKBENCH_TEST_NODE, '通过测试 runner 传入本轮 Node 路径');
  execFileSync(process.env.WORKBENCH_TEST_NODE, [path.join(root, 'scripts/seed-recovery-fixture.mjs'), recoveryDir], { cwd: root, stdio: 'pipe', windowsHide: true });
  const seed = JSON.parse(fs.readFileSync(path.join(recoveryDir, 'fixture.json'), 'utf8'));
  let firstRecovery;
  for (let attempt = 0; attempt < 2; attempt++) {
    manager = new AgentManagerClient({ entry: path.join(root, 'out/main/agent-manager.js'), dataDir: recoveryDir, onNotification: () => {}, onFailure: console.error });
    await manager.ready;
    const result = await manager.request('recovery:load', []);
    assert.equal(result.ok, true, result.error);
    const snapshot = result.data;
    assert.equal(snapshot.tasks[0].id, seed.taskId);
    assert.equal(snapshot.tasks[0].executionState, 'INTERRUPTED');
    assert.equal(snapshot.tasks[0].attentionState, 'UNCERTAIN');
    assert.equal(snapshot.events.filter(e => e.id === seed.eventId).length, 1);
    assert.equal(snapshot.events.filter(e => e.type === 'TurnInterrupted').length, 1);
    assert.deepEqual(snapshot.uncertainInputs, [{ id: seed.inputId, taskId: seed.taskId, text: '未经确认不得自动重放', status: 'UNCERTAIN' }]);
    if (firstRecovery) assert.deepEqual(snapshot, firstRecovery, '再次启动不增加事件、不重发输入、不改变任务标识');
    firstRecovery = snapshot;
    if (attempt === 1) {
      const discarded = await manager.request('input:resolve', [seed.inputId, 'discard']);
      assert.equal(discarded.ok, true, discarded.error);
      assert.deepEqual((await manager.request('recovery:load', [])).data.uncertainInputs, []);
      assert.equal((await manager.request('input:resolve', [seed.inputId, 'discard'])).ok, false, '已处理输入不得重复执行决定');
    }
    await manager.stop();
  }
  manager = new AgentManagerClient({ entry: path.join(root, 'out/main/agent-manager.js'), dataDir: recoveryDir, onNotification: () => {}, onFailure: console.error });
  await manager.ready;
  const afterDiscard = (await manager.request('recovery:load', [])).data;
  assert.deepEqual(afterDiscard.uncertainInputs, [], '丢弃决定必须跨进程重启持久化');
  assert.deepEqual(afterDiscard.events.filter(e => e.type !== 'InputResolved'), firstRecovery.events, '丢弃与重启不伪造 Runtime 事件');
  assert.equal(afterDiscard.events.filter(e => e.type === 'InputResolved').length, 1, '丢弃决定只持久化一次');
  console.log('PASS: 预置 RUNNING/SENT 崩溃现场经真实 Manager 双次启动恢复，任务/事件/不确定输入保持幂等');
  console.log('BLOCKED/NOT RUN: 真实模型编辑/审批、活动 Turn 下 Renderer/Main Kill、Provider SSE 中断；隔离测试目录无可用 Provider 配置与凭据');
}).then(async () => {
  await manager.stop();
  window?.destroy();
  app.exit(0);
}).catch(async (error) => {
  console.error(error);
  if (parent && parent.exitCode === null) parent.kill();
  if (orphanPid && alive(orphanPid)) process.kill(orphanPid);
  if (rawChild) { const exited = once(rawChild, 'exit'); rawChild.kill(); await exited; }
  if (manager) await manager.stop();
  window?.destroy();
  app.exit(1);
});
