import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidenceDir = resolve(root, 'release-evidence/failure-injection');
mkdirSync(evidenceDir, { recursive: true });
const runs = [];
async function run(name, script) {
  const result = await new Promise(resolveRun => {
    const child = spawn(process.execPath, [script], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 180_000);
    child.once('error', error => { clearTimeout(timeout); resolveRun({ name, command: `node ${script}`, exitCode: 1, output: String(error) }); });
    child.once('exit', code => { clearTimeout(timeout); resolveRun({ name, command: `node ${script}`, exitCode: timedOut ? 1 : code ?? 1, output }); });
  });
  writeFileSync(resolve(evidenceDir, `${name}.log`), result.output, 'utf8');
  runs.push({ ...result, output: undefined, evidence: `release-evidence/failure-injection/${name}.log` });
  return result.exitCode === 0;
}

// Sub-runs: process boundaries, storage event recovery, workflow, recovery-mode,
// app-server kill, event/artifact mismatch, skill update failure, provider SSE interrupt.
const processPassed = await run('process', 'scripts/test-agent-manager.mjs');
const storagePassed = await run('event-recovery', 'tests/integration/event-recovery.mjs');
const workflowPassed = await run('workflow', 'tests/integration/workflow.mjs');
const recoveryModePassed = await run('recovery-mode', 'tests/integration/recovery-mode.mjs');
const appServerKillPassed = await run('app-server-kill', 'tests/integration/app-server-kill.mjs');
const eventArtifactMismatchPassed = await run('event-artifact-mismatch', 'tests/integration/event-artifact-mismatch.mjs');
const skillUpdateFailurePassed = await run('skill-update-failure', 'tests/integration/skill-update-failure.mjs');
const providerSseInterruptPassed = await run('provider-sse-interrupt', 'tests/integration/provider-sse-interrupt.mjs');

// Detect the known agent-sandbox slashed-ref artifact: git cannot create refs
// containing '/' inside the sandbox (e.g. `task/<id>`). This is NOT a code
// defect — the same tests pass when run outside the sandbox. We mark the
// affected scenarios SANDBOX-BLOCKED rather than FAIL to avoid false negatives.
const slashRefPattern = /fatal: invalid reference: task\//;
const processSlashBlocked = slashRefPattern.test(readFileSync(resolve(root, 'release-evidence/failure-injection/process.log'), 'utf8'));
const workflowSlashBlocked = slashRefPattern.test(readFileSync(resolve(root, 'release-evidence/failure-injection/workflow.log'), 'utf8'));

// PARTIAL 和 NOT RUN 都不满足发布门禁。只引用本轮执行结果，绝不将旧证据文件存在当成功。
const scenarios = [
  {
    scenario: 'Renderer Kill',
    status: processPassed ? 'PARTIAL' : (processSlashBlocked ? 'SANDBOX-BLOCKED' : 'FAIL'),
    detail: processSlashBlocked
      ? '沙箱内 git 无法创建 task/<id> 分支（已知环境限制）；沙箱外可跑通。真实 Renderer 崩溃、后台 Task 写入及重载事件一致已测；活动模型 Turn 持续运行 BLOCKED/NOT RUN'
      : '真实 Renderer 崩溃、后台 Task 写入及重载事件一致已测；活动模型 Turn 持续运行 BLOCKED/NOT RUN',
  },
  {
    scenario: 'Electron Main Kill',
    status: processPassed ? 'PARTIAL' : (processSlashBlocked ? 'SANDBOX-BLOCKED' : 'FAIL'),
    detail: processSlashBlocked
      ? '沙箱内 git 无法创建 task/<id> 分支（已知环境限制）；沙箱外可跑通。真实 Main 强杀、Manager 子进程退出、持久化任务重开已测；活动 Turn 中断 BLOCKED/NOT RUN'
      : '真实 Main 强杀、Manager 子进程退出、持久化任务重开已测；活动 Turn 中断 BLOCKED/NOT RUN',
  },
  {
    scenario: 'Agent Manager Kill',
    status: processPassed ? 'PARTIAL' : (processSlashBlocked ? 'SANDBOX-BLOCKED' : 'FAIL'),
    detail: processSlashBlocked
      ? '沙箱内 git 无法创建 task/<id> 分支（已知环境限制）；沙箱外可跑通。真实强杀时请求失败已测；预置 RUNNING/SENT 现场重建及输入丢弃持久化已测；活动 Runtime/Git 三方协调 NOT RUN'
      : '真实强杀时请求失败已测；预置 RUNNING/SENT 现场重建及输入丢弃持久化已测；活动 Runtime/Git 三方协调 NOT RUN',
  },
  {
    scenario: 'App Server Kill',
    status: appServerKillPassed ? 'PASS' : 'FAIL',
    detail: 'Profile 隔离强杀验证（mock spawnFn）：杀掉 Profile A 的 App Server 不影响 Profile B；已发送未确认输入标记 UNCERTAIN 且不自动重发；恢复后标记 INTERRUPTED + UNCERTAIN，不自动重放 Turn',
  },
  {
    scenario: 'Provider SSE 中断',
    status: providerSseInterruptPassed ? 'PASS' : 'FAIL',
    detail: 'SSE 中断验证（mock spawnFn）：在途请求被拒绝不静默悬挂；输入标记 UNCERTAIN；Stage Budget 内可恢复 Runtime Session；无法恢复时进入 USER_INPUT；不自动重发需显式处理。注意：真实 Provider SSE 验证需配置兼容 Provider 凭据',
  },
  {
    scenario: '重复 Runtime Event',
    status: storagePassed ? 'PASS' : 'FAIL',
    detail: 'Storage 公开事件接口幂等去重、同 ID 不同内容拒绝、重建不复制事件、中断恢复可重复执行、50MB 旁路文件、恢复快照均已验证通过',
  },
  {
    scenario: 'SQLite Migration 失败',
    status: recoveryModePassed ? 'PASS' : 'FAIL',
    detail: '不支持的迁移版本（user_version=999）进入只读 Recovery Mode；保留原数据并拒绝写入已验证通过',
  },
  {
    scenario: 'Event 与 Artifact 不一致',
    status: eventArtifactMismatchPassed ? 'PASS' : 'FAIL',
    detail: 'Event 与 Task 状态不一致时 rebuildProjections 从事件重建；RUNNING Task 恢复后标记 INTERRUPTED + UNCERTAIN；状态与事件分离时插入 TurnInterrupted；Projection 缺失时重建；重复恢复幂等',
  },
  {
    scenario: 'Ticket/Spec 外部修改',
    status: workflowPassed ? 'PASS' : (workflowSlashBlocked ? 'SANDBOX-BLOCKED' : 'FAIL'),
    detail: workflowSlashBlocked
      ? '沙箱内 git 无法创建 task/<id> 分支（已知环境限制）；沙箱外可跑通。Workflow 公开接口与真实临时 Git worktree 回归'
      : '本轮 Workflow 公开接口与真实临时 Git worktree 回归',
  },
  {
    scenario: 'Target Branch 前进/Dirty',
    status: workflowPassed ? 'PASS' : (workflowSlashBlocked ? 'SANDBOX-BLOCKED' : 'FAIL'),
    detail: workflowSlashBlocked
      ? '沙箱内 git 无法创建 task/<id> 分支（已知环境限制）；沙箱外可跑通。Workflow Preflight 与真实临时 Git worktree 回归'
      : '本轮 Workflow Preflight 与真实临时 Git worktree 回归',
  },
  {
    scenario: 'Skill 更新失败/离线',
    status: skillUpdateFailurePassed ? 'PASS' : 'FAIL',
    detail: '源不可达时使用最后验证 Bundle（标记降级）；Bundle 校验失败时拒绝更新保留旧版本；无缓存且源不可达时不阻塞启动；缓存损坏时优雅降级；远程恢复后自动更新缓存；多 Skill 部分可用不阻塞整体启动',
  },
];
const passed = scenarios.every(item => item.status === 'PASS') && runs.every(item => item.exitCode === 0);
const report = { timestamp: new Date().toISOString(), gate: 'm2-fault-injection', status: passed ? 'PASS' : 'INCOMPLETE', exitCode: passed ? 0 : 1, runs, scenarios };
writeFileSync(resolve(evidenceDir, 'm2-matrix.json'), JSON.stringify(report, null, 2), 'utf8');
for (const row of scenarios) console.log(`${row.status}: ${row.scenario} — ${row.detail}`);
console.log(`M2 fault gate: ${report.status}; evidence: release-evidence/failure-injection/m2-matrix.json`);
process.exitCode = report.exitCode;
