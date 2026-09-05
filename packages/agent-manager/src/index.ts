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
import { AgentManagerService } from './service';
import { MANAGER_PROTOCOL_VERSION, isManagerEnvelope, validManagerRequest, err, type ManagerEnvelope } from '@workbench/shared';

const port = process.parentPort;
if (!port) throw new Error('Agent Manager 必须由 Electron Utility Process 启动');
let sequence = 0;
const send = (message: Omit<ManagerEnvelope, 'version' | 'messageId'>) => {
  port.postMessage({ ...message, version: MANAGER_PROTOCOL_VERSION, messageId: ++sequence });
};
const service = new AgentManagerService(process.argv[2], (channel, payload) => {
  send({ kind: 'notification', requestId: 0, channel, payload });
});
let queue = Promise.resolve();
let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  void queue.then(() => {
    service.close();
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
