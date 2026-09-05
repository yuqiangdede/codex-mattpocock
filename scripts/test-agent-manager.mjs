import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
mkdirSync(resolve(root, 'cache'), { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// headless 环境 Electron GPU 进程无法启动；用软件光栅 + 禁用沙箱绕过。
env.ELECTRON_DISABLE_GPU = '1';
env.ELECTRON_ENABLE_LOGGING = '0';
const electronArgs = ['--disable-gpu', '--disable-software-rasterizer', '--no-sandbox', '--disable-dev-shm-usage'];
const results = [];
for (const suite of ['agent-manager', 'boot-smoke']) {
  const result = await new Promise(resolveResult => {
    let output = '';
    let timedOut = false;
    const child = spawn(require('electron'), [...electronArgs, `tests/integration/${suite}.cjs`], {
      cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
      output += data.toString();
      process.stdout.write(data);
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      console.error(`FAIL: ${suite} 超过 120 秒`);
      child.kill();
    }, 120_000);
    child.on('error', error => {
      clearTimeout(timeout);
      resolveResult({ suite, exitCode: 1, output: String(error) });
    });
    child.on('exit', code => {
      clearTimeout(timeout);
      resolveResult({ suite, exitCode: timedOut ? 1 : code ?? 1, output });
    });
  });
  results.push(result);
  if (result.exitCode !== 0) break;
}
mkdirSync(resolve(root, 'release-evidence'), { recursive: true });
writeFileSync(resolve(root, 'release-evidence/agent-manager-integration.json'), JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
process.exitCode = results.some(r => r.exitCode !== 0) ? 1 : 0;
