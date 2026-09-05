/**
 * @workbench/agent-manager
 *
 * The sole application write model. Runs in an Electron utilityProcess.
 * Responsible for: ProjectManager, TaskManager, WorkflowEngine,
 * ContextManager, ArtifactManager, GitWorktreeManager,
 * PermissionManager, RuntimeSupervisor, EventStore.
 *
 * 业务写入和事件存储运行于独立进程。
 */
import type {} from 'electron';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { AgentManagerService } from './service';
import {
  RuntimeSessionManager,
} from '@workbench/runtime-codex';
import {
  MANAGER_PROTOCOL_VERSION,
  isManagerEnvelope,
  validManagerRequest,
  err,
  type ManagerEnvelope,
} from '@workbench/shared';

const port = process.parentPort;
if (!port) throw new Error('Agent Manager 必须由 Electron Utility Process 启动');
const dataDir = process.argv[2];
if (!dataDir) throw new Error('未传入 dataDir');
let sequence = 0;
const send = (message: Omit<ManagerEnvelope, 'version' | 'messageId'>) => {
  port.postMessage({ ...message, version: MANAGER_PROTOCOL_VERSION, messageId: ++sequence });
};

/**
 * 构造 Runtime Session Manager。codex 二进制路径由环境变量 WORKBENCH_CODEX_BIN
 * 或 WORKBENCH_SMOKE_TEST 模式下的 runtime/codex.exe 提供；Provider 配置目录
 * 落在 dataDir 下，独立于 Worktree 与 SQLite。
 */
function buildRuntime(dataDir: string): RuntimeSessionManager | undefined {
  const codexBin = process.env.WORKBENCH_CODEX_BIN
    ?? (existsSync(path.join(process.cwd(), 'runtime', 'codex.exe'))
      ? path.join(process.cwd(), 'runtime', 'codex.exe')
      : null);
  if (!codexBin) {
    console.warn('[agent-manager] 未找到 Codex 二进制；真实 Turn 通道将不可用');
    return undefined;
  }
  const configDir = path.join(dataDir, 'runtime-config');
  const codexHomeRoot = path.join(dataDir, 'codex-home');
  return new RuntimeSessionManager({
    binaryPath: codexBin,
    codexHomeRoot,
    configDir,
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
    onNotification: () => {},
    onApprovalRequest: () => Promise.resolve('decline'),
  });
}

const runtime = buildRuntime(dataDir);
const service = new AgentManagerService({
  dataDir,
  notify: (channel, payload) => {
    send({ kind: 'notification', requestId: 0, channel, payload });
  },
  runtime,
});
if (runtime) service.wireRuntimeCallbacks();
let queue = Promise.resolve();
let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await queue.then(async () => {
    await service.close();
    process.exit(0);
  }).catch(error => { console.error('Agent Manager 关闭失败', error); process.exit(1); });
}

// parentPort 没有关闭事件，使用父进程存活检查处理 Main 异常消失。
const parentPid = Number(process.argv[3]);
if (!Number.isSafeInteger(parentPid) || parentPid <= 0) throw new Error('无效 Main 进程标识');
setInterval(() => {
  try { process.kill(parentPid, 0); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') shutdown();
  }
}, 500).unref();
let highestRequestId = 0;
const responses = new Map<number, { fingerprint: string; result: ManagerEnvelope['result'] }>();
port.on('message', ({ data }: Electron.MessageEvent) => {
  if (!isManagerEnvelope(data)) return;
  if (stopping) return;
  // Main 确认收到响应后即可释放结果；高水位保证旧请求永远不会再次执行。
  if (data.kind === 'ack') { responses.delete(data.requestId); return; }
  if (data.kind === 'request') {
    queue = queue.then(async () => {
      send({ kind: 'ack', requestId: data.requestId });
      const fingerprint = JSON.stringify([data.channel, data.args]);
      const cached = responses.get(data.requestId);
      if (cached || data.requestId <= highestRequestId) {
        send({ kind: 'response', requestId: data.requestId, result:
          cached?.fingerprint === fingerprint ? cached.result : err('请求已处理或标识冲突；拒绝重新执行') });
        return;
      }
      highestRequestId = data.requestId;
      const result = validManagerRequest(data.channel, data.args)
        ? await service.request(data.channel!, data.args)
        : err('无效业务请求');
      responses.set(data.requestId, { fingerprint, result });
      send({ kind: 'response', requestId: data.requestId, result });
    });
  } else if (data.kind === 'shutdown') {
    shutdown();
  }
});
send({ kind: 'ready', requestId: 0 });
