import { utilityProcess, ipcMain, type UtilityProcess, type BrowserWindow } from 'electron';
import { MANAGER_PROTOCOL_VERSION, MANAGER_REQUEST_CHANNELS, isManagerEnvelope, validManagerRequest, err, type IpcResult, type ManagerEnvelope } from '@workbench/shared';

interface ManagerOptions {
  entry: string;
  dataDir: string;
  onNotification: (channel: string, payload: unknown) => void;
  onFailure: (message: string) => void;
}

/** Main 侧只负责传输与进程监督，不持有数据库和业务处理器。 */
export class AgentManagerClient {
  readonly ready: Promise<void>;
  private readonly child: UtilityProcess;
  private readonly pending = new Map<number, { resolve: (result: IpcResult<unknown>) => void; timer: ReturnType<typeof setTimeout> }>();
  private sequence = 0;
  private requestSequence = 0;
  private receivedSequence = 0;
  private stopped = false;
  private failure: string | null = null;
  private readonly exited: Promise<number>;

  constructor(options: ManagerOptions) {
    this.child = utilityProcess.fork(options.entry, [options.dataDir, String(process.pid)], { stdio: 'pipe', serviceName: 'Agent Manager' });
    this.child.stdout?.on('data', data => process.stdout.write(data));
    this.child.stderr?.on('data', data => process.stderr.write(data));
    this.exited = new Promise(resolve => this.child.once('exit', resolve));
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('Agent Manager 启动超时')); this.child.kill(); }, 15_000);
      this.child.on('message', (message: unknown) => {
        if (!isManagerEnvelope(message)) return;
        if (message.messageId <= this.receivedSequence) return;
        this.receivedSequence = message.messageId;
        if (message.kind === 'ready') { clearTimeout(timer); resolve(); }
        if (message.kind === 'notification' && (message.channel === 'event:stream' || message.channel === 'approval:request')) options.onNotification(message.channel, message.payload);
        if (message.kind === 'response') {
          this.send({ kind: 'ack', requestId: message.requestId });
          const pending = this.pending.get(message.requestId);
          if (pending && message.result) {
            clearTimeout(pending.timer);
            this.pending.delete(message.requestId);
            pending.resolve(message.result);
          }
        }
      });
      this.child.once('exit', code => {
        clearTimeout(timer);
        this.failure = `Agent Manager 已退出（code=${code}），请重启应用`;
        reject(new Error(this.failure));
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.resolve(err(this.failure)); }
        this.pending.clear();
        if (!this.stopped) options.onFailure(this.failure);
      });
    });
  }

  get pid(): number | undefined { return this.child.pid; }

  private send(message: Omit<ManagerEnvelope, 'version' | 'messageId'>): void {
    this.child.postMessage({ ...message, version: MANAGER_PROTOCOL_VERSION, messageId: ++this.sequence });
  }

  async request(channel: string, args: unknown[]): Promise<IpcResult<unknown>> {
    if (this.failure || this.stopped) return err(this.failure ?? 'Agent Manager 正在退出');
    if (!validManagerRequest(channel, args)) return err('无效业务请求');
    try { await this.ready; } catch (error) { return err(String(error)); }
    if (this.failure || this.stopped) return err(this.failure ?? 'Agent Manager 正在退出');
    return new Promise(resolve => {
      const requestId = ++this.requestSequence;
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(err('请求超时，执行结果不确定；不会自动重发'));
      }, 75_000);
      this.pending.set(requestId, { resolve, timer });
      this.send({ kind: 'request', requestId, channel, args });
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) { await this.exited; return; }
    this.stopped = true;
    if (!this.failure) this.send({ kind: 'shutdown', requestId: 0 });
    const timer = setTimeout(() => this.child.kill(), 70_000);
    await this.exited;
    clearTimeout(timer);
  }
}

export function registerManagerIpc(manager: AgentManagerClient, getWindow: () => BrowserWindow | null): void {
  for (const channel of MANAGER_REQUEST_CHANNELS) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const window = getWindow();
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return err('不可信 IPC 来源');
      return manager.request(channel, args);
    });
  }
}
