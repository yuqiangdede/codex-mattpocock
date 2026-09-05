import { app, BrowserWindow, dialog } from 'electron';
import * as path from 'node:path';
import { AgentManagerClient, registerManagerIpc } from './manager-bridge';

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let manager: AgentManagerClient | null = null;
let quitting = false;
let closed = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  manager = new AgentManagerClient({
    entry: path.join(__dirname, 'agent-manager.js'),
    dataDir: app.getPath('userData'),
    onNotification: (channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    },
    onFailure: (message) => {
      console.error(message);
      if (!quitting) dialog.showErrorBox('Agent Manager 已停止', message);
    },
  });
  await manager.ready;
  registerManagerIpc(manager, () => mainWindow);
  createWindow();

  if (process.env.WORKBENCH_SMOKE_TEST === '1') {
    const result = await manager.request('project:list', []);
    const windowCreated = BrowserWindow.getAllWindows().length > 0;
    console.log(`[smoke] managerReady=${result.ok} windowCreated=${windowCreated} managerPid=${manager.pid}`);
    quitting = true;
    await manager.stop();
    app.exit(result.ok && windowCreated ? 0 : 1);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !quitting) createWindow();
  });
}).catch(async error => {
  console.error('应用启动失败', error);
  quitting = true;
  if (manager) await manager.stop();
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 先等待业务进程关闭数据库，再让 Electron 退出。
app.on('before-quit', event => {
  if (closed || !manager) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void manager.stop().then(() => {
    closed = true;
    app.quit();
  });
});
