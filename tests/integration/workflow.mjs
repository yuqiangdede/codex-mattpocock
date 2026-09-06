import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DeliveryWorkflow } from '../../packages/workflow/dist/index.js';

const root = resolve('cache');
mkdirSync(root, { recursive: true });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
function fixture() {
  const dir = mkdtempSync(join(root, 'workflow-'));
  const repo = join(dir, 'repo'); mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Workflow test'); git(repo, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(join(repo, 'base.txt'), 'base\n'); git(repo, 'add', 'base.txt'); git(repo, 'commit', '-m', 'base');
  return { dir, repo, options: { taskId: 'parent', projectPath: repo, parentWorktree: repo, dataDir: join(dir, 'data'), worktreeDir: join(dir, 'children'), spec: 'approved spec', baseRef: 'main', runChild: async () => ({ status: 'failed' }), runReviewer: async () => ({ status: 'completed', findings: [] }) } };
}
const ticket = (id, dependsOn = []) => ({ id, title: id, dependsOn, instructions: 'Implement ' + id, acceptance: ['works'], verification: ['node test.js'], scope: ['src'], label: 'ready-for-agent' });
async function reviewed() {
  const f = fixture();
  f.options.runChild = async ({ cwd }) => { writeFileSync(join(cwd, 'A.txt'), 'A'); return { status: 'completed' }; };
  const workflow = new DeliveryWorkflow(f.options); workflow.addTickets([ticket('A')]); await workflow.runTicket('A');
  workflow.prepareCandidate(['A']); workflow.verify({ file: process.execPath, args: ['-e', 'process.exit(0)'] }, ['works']); await workflow.review();
  return { ...f, workflow };
}

test('DAG 稳定身份、frontier 和环诊断', () => {
  const { options } = fixture(); const workflow = new DeliveryWorkflow(options);
  workflow.addTickets([ticket('A'), ticket('B', ['A']), ticket('C')]);
  assert.deepEqual(workflow.getState().frontier, ['A', 'C']);
  assert.throws(() => workflow.addTickets([ticket('D', ['E']), ticket('E', ['D'])]), /D.*E.*D/);
  assert.equal(workflow.getState().tickets.length, 3);
});

test('Preflight 拒绝 dirty、目标前进、Spec/Ticket 修改和失效验证并落盘证据', async () => {
  const { repo, options, workflow } = await reviewed();
  assert.equal(workflow.preflight().passed, true);
  writeFileSync(join(repo, 'dirty.txt'), 'dirty');
  assert.ok(workflow.preflight().blockers.includes('dirty-target'));
  git(repo, 'add', 'dirty.txt'); git(repo, 'commit', '-m', 'external');
  assert.ok(workflow.preflight().blockers.includes('target-changed'));
  writeFileSync(join(options.dataDir, 'A.md'), 'external Ticket edit');
  writeFileSync(join(options.dataDir, 'spec.md'), 'changed spec');
  writeFileSync(join(workflow.getState().candidate.worktree, 'A.txt'), 'changed candidate');
  const report = workflow.preflight();
  assert.ok(report.blockers.includes('stale-ticket:A'));
  assert.ok(report.blockers.includes('spec-changed'));
  assert.ok(report.blockers.includes('stale-verification'));
  await assert.rejects(workflow.integrate('merge'), /Preflight/);
});

test('明确选择 merge、cherry-pick 或 patch 才集成且不 push', async () => {
  for (const mode of ['merge', 'cherry-pick', 'patch']) {
    const { repo, workflow } = await reviewed();
    const before = git(repo, 'rev-parse', 'HEAD');
    const result = await workflow.integrate(mode);
    assert.equal(result.passed, true);
    if (mode === 'patch') { assert.ok(result.artifactPath.endsWith('.patch')); assert.equal(git(repo, 'rev-parse', 'HEAD'), before); }
    else assert.equal(git(repo, 'show', 'HEAD:A.txt'), 'A');
    assert.equal(git(repo, 'remote'), '');
  }
});

test('Candidate 汇总已选 Child 并执行真实验证，Review 双 Session 严重发现与理由持久化', async () => {
  const { options } = fixture(); const sessions = [];
  options.runChild = async ({ cwd }) => { writeFileSync(join(cwd, 'A.txt'), 'A'); return { status: 'completed' }; };
  options.runReviewer = async ({ taskId, mode }) => {
    sessions.push(taskId);
    return { status: 'completed', findings: mode === 'custom' ? [{ id: 'f1', severity: 'High', specItem: 'works', ticketId: 'A', file: 'A.txt', line: 1, evidence: '缺少断言', message: '补充验证' }] : [] };
  };
  const workflow = new DeliveryWorkflow(options); workflow.addTickets([ticket('A')]); await workflow.runTicket('A');
  workflow.prepareCandidate(['A']);
  workflow.verify({ file: process.execPath, args: ['-e', "require('node:assert').equal(require('node:fs').readFileSync('A.txt','utf8'),'A')"] }, ['works']);
  await workflow.review();
  assert.equal(workflow.getState().review, 'blocked');
  assert.equal(new Set(sessions).size, 2);
  assert.throws(() => workflow.ignoreFinding('f1', ' '), /理由/);
  workflow.ignoreFinding('f1', '本次验收已有真实断言');
  assert.equal(workflow.getState().review, 'passed');
  assert.equal(new DeliveryWorkflow(options).getState().findings[0].ignoredReason, '本次验收已有真实断言');
  workflow.reviseFinding('f1', 'fix-f1');
  assert.ok(workflow.getState().frontier.includes('fix-f1'));
});

test('Child 在独立真实 worktree 提交且依赖继承完成结果，失败不阻塞无关 Ticket', async () => {
  const { repo, options } = fixture();
  options.runChild = async ({ cwd, prompt }) => {
    if (prompt.includes('Implement F')) return { status: 'failed', error: '模型失败' };
    if (prompt.includes('Implement B')) assert.equal(git(cwd, 'show', 'HEAD:A.txt'), 'A');
    const name = prompt.includes('Implement B') ? 'B' : 'A';
    writeFileSync(join(cwd, name + '.txt'), name);
    return { status: 'completed' };
  };
  const workflow = new DeliveryWorkflow(options);
  workflow.addTickets([ticket('A'), ticket('B', ['A']), ticket('F'), ticket('G', ['F'])]);
  await assert.rejects(workflow.runTicket('B'), /frontier/);
  await workflow.runTicket('F');
  assert.deepEqual(workflow.getState().frontier, ['A']);
  await workflow.runTicket('A'); await workflow.runTicket('B');
  const state = workflow.getState();
  assert.equal(state.tickets.find(t => t.id === 'B').status, 'completed');
  assert.notEqual(state.tickets[0].worktree, repo);
  assert.equal(git(repo, 'status', '--porcelain'), '');
  assert.equal(new DeliveryWorkflow(options).getState().tickets[1].commit, state.tickets[1].commit);
});
