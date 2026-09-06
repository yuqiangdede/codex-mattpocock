import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

export interface TicketInput {
  id: string; title: string; dependsOn: string[]; instructions: string;
  acceptance: string[]; verification: string[]; scope: string[];
  label: 'ready-for-agent' | 'needs-info' | 'ready-for-human';
}
export interface Ticket extends TicketInput {
  status: 'pending' | 'running' | 'completed' | 'failed';
  snapshotHash: string; childTaskId?: string; worktree?: string; baseCommit?: string; commit?: string; error?: string;
}
export interface Finding {
  id: string; severity: 'Critical' | 'High' | 'Medium' | 'Low'; specItem: string; ticketId: string;
  file: string; line: number; evidence: string; message: string; ignoredReason?: string; revisionTicketId?: string;
}
export interface RuntimeRequest { taskId: string; cwd: string; prompt: string; }
export interface RuntimeResult { status: 'completed' | 'failed' | 'cancelled'; error?: string; }
export interface ReviewerRequest extends RuntimeRequest { mode: 'uncommittedChanges' | 'custom'; }
export interface WorkflowOptions {
  taskId: string; projectPath: string; parentWorktree: string; dataDir: string; worktreeDir: string;
  spec: string; baseRef: string;
  runChild: (request: RuntimeRequest) => Promise<RuntimeResult>;
  runReviewer: (request: ReviewerRequest) => Promise<RuntimeResult & { findings: Finding[] }>;
  cancelSession?: (taskId: string) => Promise<void>;
  onChange?: (state: WorkflowState) => void;
}
export interface WorkflowState {
  taskId: string; specHash: string; baseCommit: string; tickets: Ticket[]; frontier: string[]; topology: string[];
  findings: Finding[]; review: 'pending' | 'running' | 'passed' | 'blocked' | 'cancelled';
  attention: 'NONE' | 'REVIEW' | 'UNCERTAIN';
  candidate?: { worktree: string; commit: string; ticketIds: string[]; ticketHashes: Record<string, string>; specHash: string; targetCommit: string; targetBranch: string };
  verification?: { fingerprint: string; passed: boolean; command: { file: string; args: string[] }; output: string; acceptance: string[] };
  reviewSessionIds?: string[]; reviewFingerprint?: string;
}
export interface PreflightReport { passed: boolean; blockers: string[]; artifactPath: string; candidateCommit?: string; targetCommit?: string; }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd, input, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 20 * 1024 * 1024 }).trim();
}
function fingerprint(cwd: string): string {
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).sort();
  return hash(git(cwd, ['rev-parse', 'HEAD']) + git(cwd, ['diff', '--binary', 'HEAD']) + untracked.map(path => path + hash(readFileSync(join(cwd, path)).toString('base64'))).join('\n'));
}
function atomicWrite(path: string, content: string): void {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, content, 'utf8'); const fd = openSync(temp, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
}
export class DeliveryWorkflow {
  private state: WorkflowState;
  private readonly statePath: string;
  constructor(private readonly options: WorkflowOptions) {
    mkdirSync(options.dataDir, { recursive: true });
    this.statePath = join(options.dataDir, 'workflow.json');
    if (!existsSync(this.statePath)) atomicWrite(join(options.dataDir, 'spec.md'), options.spec);
    this.state = existsSync(this.statePath) ? JSON.parse(readFileSync(this.statePath, 'utf8')) as WorkflowState : {
      taskId: options.taskId, specHash: hash(options.spec), baseCommit: git(options.parentWorktree, ['rev-parse', '--verify', `${options.baseRef}^{commit}`]), tickets: [], frontier: [], topology: [], findings: [], review: 'pending', attention: 'NONE',
    };
    for (const ticket of this.state.tickets) if (ticket.status === 'running') { ticket.status = 'failed'; ticket.error = '上次执行中断，请人工检查保留的 Worktree'; this.state.attention = 'UNCERTAIN'; }
  }
  getState(): WorkflowState { return structuredClone(this.state); }
  private save(): void {
    this.state.frontier = this.state.tickets.filter(t => t.status === 'pending' && t.label === 'ready-for-agent' && t.dependsOn.every(id => this.state.tickets.find(b => b.id === id)?.status === 'completed')).map(t => t.id);
    atomicWrite(this.statePath, JSON.stringify(this.state, null, 2)); this.options.onChange?.(this.getState());
  }
  addTickets(inputs: TicketInput[]): WorkflowState {
    const tickets = [...this.state.tickets];
    for (const input of inputs) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(input.id) || tickets.some(t => t.id === input.id)) throw new Error(`无效或重复 Ticket ID: ${input.id}`);
      if (!['ready-for-agent', 'needs-info', 'ready-for-human'].includes(input.label) || !input.title.trim() || !input.acceptance.length || !input.verification.length) throw new Error('Ticket 意图不完整');
      tickets.push({ ...structuredClone(input), status: 'pending', snapshotHash: hash(JSON.stringify(input)) });
    }
    const order: string[] = []; const visited = new Set<string>();
    const visit = (id: string, chain: string[]) => {
      if (chain.includes(id)) throw new Error(`Ticket DAG 环: ${[...chain.slice(chain.indexOf(id)), id].join(' -> ')}`);
      if (visited.has(id)) return;
      const ticket = tickets.find(t => t.id === id); if (!ticket) throw new Error(`未知 blocker: ${id}`);
      for (const dependency of ticket.dependsOn) visit(dependency, [...chain, id]);
      visited.add(id); order.push(id);
    };
    for (const ticket of tickets) visit(ticket.id, []);
    this.state.tickets = tickets; this.state.topology = order;
    for (const input of inputs) atomicWrite(join(this.options.dataDir, `${input.id}.md`), `---\n${JSON.stringify(input, null, 2)}\n---\n`);
    this.save(); return this.getState();
  }
  async runTicket(id: string): Promise<WorkflowState> {
    if (!this.state.frontier.includes(id)) throw new Error(`Ticket 不在 frontier: ${id}`);
    if (hash(this.options.spec) !== this.state.specHash) throw new Error('Spec 已变化，需要重新批准');
    const ticket = this.state.tickets.find(t => t.id === id)!;
    ticket.status = 'running'; ticket.childTaskId = `${this.options.taskId}-child-${id}-${randomUUID()}`;
    ticket.worktree = join(this.options.worktreeDir, ticket.childTaskId);
    this.save();
    try {
      mkdirSync(this.options.worktreeDir, { recursive: true });
      git(this.options.projectPath, ['worktree', 'add', '-b', `task/${ticket.childTaskId}`, ticket.worktree, this.state.baseCommit]);
      // 依赖仅汇入当前 Child 的隔离目录，保留 Parent 的人工集成 Gate。
      for (const blocker of ticket.dependsOn) {
        const commit = this.state.tickets.find(t => t.id === blocker)!.commit!;
        git(ticket.worktree, ['merge', '--no-edit', commit]);
      }
      ticket.baseCommit = git(ticket.worktree, ['rev-parse', 'HEAD']); this.save();
      const result = await this.options.runChild({ taskId: ticket.childTaskId, cwd: ticket.worktree, prompt: `已批准 Spec:\n${this.options.spec}\nTicket:\n${ticket.instructions}\n验收:\n${ticket.acceptance.join('\n')}\n验证:\n${ticket.verification.join('\n')}` });
      if (result.status !== 'completed') throw new Error(result.error || `Child ${result.status}`);
      const paths = git(ticket.worktree, ['ls-files', '--modified', '--deleted', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
      if (paths.length) git(ticket.worktree, ['add', '--', ...paths]);
      if (git(ticket.worktree, ['diff', '--cached', '--name-only'])) git(ticket.worktree, ['commit', '-m', `Ticket ${id}: ${ticket.title}`]);
      ticket.commit = git(ticket.worktree, ['rev-parse', 'HEAD']); ticket.status = 'completed';
    } catch (error) { ticket.status = 'failed'; ticket.error = String(error); }
    this.save(); return this.getState();
  }
  prepareCandidate(ticketIds: string[]): WorkflowState {
    if (this.state.review === 'running') throw new Error('Review 正在运行');
    if (!ticketIds.length || new Set(ticketIds).size !== ticketIds.length) throw new Error('必须选择不重复的 Child Ticket');
    const selected = ticketIds.map(id => {
      const ticket = this.state.tickets.find(t => t.id === id);
      if (!ticket || ticket.status !== 'completed' || !ticket.commit) throw new Error(`Child 未完成: ${id}`);
      if (ticket.dependsOn.some(dep => !ticketIds.includes(dep))) throw new Error(`未选中依赖: ${id}`);
      return ticket;
    });
    const id = `${this.options.taskId}-candidate-${randomUUID()}`; const worktree = join(this.options.worktreeDir, id);
    mkdirSync(this.options.worktreeDir, { recursive: true });
    git(this.options.projectPath, ['worktree', 'add', '-b', `task/${id}`, worktree, this.state.baseCommit]);
    for (const ticket of selected) git(worktree, ['merge', '--no-edit', ticket.commit!]);
    this.state.candidate = { worktree, commit: git(worktree, ['rev-parse', 'HEAD']), ticketIds, ticketHashes: Object.fromEntries(selected.map(t => [t.id, hash(readFileSync(join(this.options.dataDir, `${t.id}.md`), 'utf8'))])), specHash: this.state.specHash, targetCommit: git(this.options.parentWorktree, ['rev-parse', 'HEAD']), targetBranch: git(this.options.parentWorktree, ['symbolic-ref', 'HEAD']) };
    this.state.verification = undefined; this.state.review = 'pending'; this.state.findings = []; this.save(); return this.getState();
  }
  verify(command: { file: string; args: string[] }, acceptance: string[]): WorkflowState {
    const candidate = this.state.candidate; if (!candidate) throw new Error('尚无 Integration Candidate');
    if (!command.file || !Array.isArray(command.args) || !acceptance.length) throw new Error('验证命令和验收标准不能为空');
    const before = fingerprint(candidate.worktree);
    const result = spawnSync(command.file, command.args, { cwd: candidate.worktree, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
    this.state.verification = { fingerprint: before, passed: result.status === 0 && before === fingerprint(candidate.worktree), command, output: `${result.stdout || ''}${result.stderr || ''}${result.error || ''}`.slice(-20_000), acceptance };
    this.state.review = 'pending'; this.save(); return this.getState();
  }
  async review(): Promise<WorkflowState> {
    const candidate = this.state.candidate; const verification = this.state.verification;
    if (!candidate || !verification?.passed || verification.fingerprint !== fingerprint(candidate.worktree)) throw new Error('需要当前 Candidate 的有效验证结果');
    if (this.state.review === 'running') throw new Error('Review 已运行');
    const run = randomUUID();
    this.state.reviewSessionIds = ['uncommittedChanges', 'custom'].map(mode => `${this.options.taskId}-review-${run}-${mode}`);
    this.state.review = 'running'; this.state.findings = []; this.state.reviewFingerprint = fingerprint(candidate.worktree); this.save();
    const prompt = `已批准 Spec:\n${this.options.spec}\nTickets:\n${JSON.stringify(this.state.tickets.filter(t => candidate.ticketIds.includes(t.id)))}\n完整 Candidate Diff:\n${git(candidate.worktree, ['diff', this.state.baseCommit, candidate.commit])}\n验证结果:\n${JSON.stringify(verification)}\n只审查，不修改文件。返回 JSON {findings:[{id,severity,specItem,ticketId,file,line,evidence,message}]}。严重度为 Critical/High/Medium/Low。`;
    try {
      const results = await Promise.all((['uncommittedChanges', 'custom'] as const).map((mode, index) => this.options.runReviewer({ taskId: this.state.reviewSessionIds![index], cwd: candidate.worktree, mode, prompt })));
      if (this.getState().review === 'cancelled') return this.getState();
      if (results.some(r => r.status !== 'completed')) throw new Error('Reviewer 未完成');
      const ids = new Set<string>();
      for (const [index, result] of results.entries()) for (const finding of result.findings) {
        if (!['Critical', 'High', 'Medium', 'Low'].includes(finding.severity) || !finding.specItem || !candidate.ticketIds.includes(finding.ticketId) || !finding.file || !Number.isInteger(finding.line) || finding.line < 1 || !finding.evidence || !finding.message || !finding.id) throw new Error('Reviewer Finding 缺少可追踪证据');
        const id = ids.has(finding.id) ? `${index}-${finding.id}` : finding.id; ids.add(id);
        this.state.findings.push({ id, severity: finding.severity, specItem: finding.specItem, ticketId: finding.ticketId, file: finding.file, line: finding.line, evidence: finding.evidence, message: finding.message });
      }
      if (this.state.reviewFingerprint !== fingerprint(candidate.worktree)) throw new Error('Review 期间 Candidate 变化');
      this.updateReviewGate();
      atomicWrite(join(this.options.dataDir, 'completion-evidence.json'), JSON.stringify({ candidate, verification, reviewSessionIds: this.state.reviewSessionIds, findings: this.state.findings }, null, 2));
    } catch (error) { if (this.getState().review !== 'cancelled') { this.state.review = 'blocked'; this.state.attention = 'UNCERTAIN'; } this.save(); throw error; }
    this.save(); return this.getState();
  }
  private updateReviewGate(): void {
    this.state.review = this.state.findings.some(f => ['Critical', 'High'].includes(f.severity) && !f.ignoredReason) ? 'blocked' : 'passed'; this.state.attention = 'REVIEW';
  }
  ignoreFinding(id: string, reason: string): WorkflowState {
    if (!reason.trim()) throw new Error('忽略 Finding 必须填写理由');
    const finding = this.state.findings.find(f => f.id === id); if (!finding) throw new Error('未知 Finding');
    finding.ignoredReason = reason.trim(); this.updateReviewGate(); this.save(); return this.getState();
  }
  reviseFinding(id: string, ticketId: string): WorkflowState {
    const finding = this.state.findings.find(f => f.id === id); if (!finding) throw new Error('未知 Finding');
    this.addTickets([{ id: ticketId, title: finding.message, dependsOn: [finding.ticketId], instructions: `${finding.message}\n${finding.file}:${finding.line}\n${finding.evidence}`, acceptance: [finding.specItem], verification: this.state.tickets.find(t => t.id === finding.ticketId)!.verification, scope: [finding.file], label: 'ready-for-agent' }]);
    finding.revisionTicketId = ticketId; this.state.review = 'pending'; this.save(); return this.getState();
  }
  async cancelReview(): Promise<WorkflowState> {
    this.state.review = 'cancelled'; this.state.attention = 'UNCERTAIN'; this.save();
    await Promise.all((this.state.reviewSessionIds || []).map(id => this.options.cancelSession?.(id))); return this.getState();
  }
  preflight(targetPath = this.options.parentWorktree): PreflightReport {
    const blockers: string[] = []; const candidate = this.state.candidate;
    if (targetPath !== this.options.parentWorktree) blockers.push('unapproved-target');
    let targetCommit: string | undefined;
    try {
      if (git(targetPath, ['status', '--porcelain']).length) blockers.push('dirty-target');
      targetCommit = git(targetPath, ['rev-parse', 'HEAD']);
      if (candidate && (targetCommit !== candidate.targetCommit || git(targetPath, ['symbolic-ref', 'HEAD']) !== candidate.targetBranch)) blockers.push('target-changed');
    } catch { blockers.push('target-unavailable'); }
    if (!candidate) blockers.push('missing-candidate');
    else {
      try {
        if (git(candidate.worktree, ['rev-parse', 'HEAD']) !== candidate.commit) blockers.push('candidate-changed');
        const current = fingerprint(candidate.worktree);
        if (!this.state.verification?.passed || this.state.verification.fingerprint !== current) blockers.push('stale-verification');
        if (this.state.reviewFingerprint !== current) blockers.push('stale-review');
        if (git(candidate.worktree, ['status', '--porcelain']).length) blockers.push('dirty-candidate');
      } catch { blockers.push('candidate-unavailable'); }
      for (const id of candidate.ticketIds) {
        try { if (hash(readFileSync(join(this.options.dataDir, `${id}.md`), 'utf8')) !== candidate.ticketHashes[id]) blockers.push(`stale-ticket:${id}`); }
        catch { blockers.push(`stale-ticket:${id}`); }
      }
      const required = this.state.tickets.filter(t => candidate.ticketIds.includes(t.id)).flatMap(t => t.acceptance);
      if (required.some(item => !this.state.verification?.acceptance.includes(item))) blockers.push('missing-acceptance-evidence');
    }
    try { if (hash(readFileSync(join(this.options.dataDir, 'spec.md'), 'utf8')) !== this.state.specHash || hash(this.options.spec) !== this.state.specHash) blockers.push('spec-changed'); }
    catch { blockers.push('spec-changed'); }
    if (this.state.review !== 'passed') blockers.push('review-gate');
    if (this.state.attention === 'UNCERTAIN') blockers.push('uncertain-execution');
    const report: PreflightReport = { passed: !blockers.length, blockers, artifactPath: join(this.options.dataDir, 'preflight-evidence.json'), candidateCommit: candidate?.commit, targetCommit };
    atomicWrite(report.artifactPath, JSON.stringify(report, null, 2)); return report;
  }
  async integrate(mode: 'merge' | 'cherry-pick' | 'patch', targetPath = this.options.parentWorktree): Promise<PreflightReport> {
    if (!['merge', 'cherry-pick', 'patch'].includes(mode)) throw new Error('未知集成方式');
    const report = this.preflight(targetPath); if (!report.passed) throw new Error(`Preflight 阻止集成: ${report.blockers.join(', ')}`);
    const candidate = this.state.candidate!;
    if (mode === 'patch') {
      const artifactPath = join(this.options.dataDir, 'integration.patch');
      // 保留 Diff 的尾换行，Patch 可被标准 git apply 消费。
      const patch = execFileSync('git', ['diff', '--binary', this.state.baseCommit, candidate.commit], { cwd: candidate.worktree, encoding: 'utf8', windowsHide: true });
      atomicWrite(artifactPath, patch); return { ...report, artifactPath };
    }
    if (mode === 'merge') git(targetPath, ['merge', '--no-edit', candidate.commit]);
    else {
      const commits = git(candidate.worktree, ['rev-list', '--reverse', '--no-merges', `${this.state.baseCommit}..${candidate.commit}`]).split('\n').filter(Boolean);
      if (commits.length) git(targetPath, ['cherry-pick', ...commits]);
    }
    return report;
  }
}
