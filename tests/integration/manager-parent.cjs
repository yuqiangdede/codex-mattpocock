const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { AgentManagerClient } = require('../../out/main/manager-bridge.js');
const dataDir = process.argv[2];
app.setPath('userData', path.join(dataDir, 'electron'));
app.whenReady().then(async () => {
  const manager = new AgentManagerClient({
    entry: path.resolve(__dirname, '../../out/main/agent-manager.js'), dataDir,
    onNotification: () => {}, onFailure: console.error,
  });
  await manager.ready;
  const project = await manager.request('project:scan', [dataDir]);
  const task = await manager.request('task:create', [project.data.id, '验证父进程失联']);
  await manager.request('turn:start', [task.data.id]);
  fs.writeFileSync(path.join(dataDir, 'ready.json'), JSON.stringify({ pid: manager.pid, taskId: task.data.id }));
}).catch(error => { console.error(error); app.exit(1); });
