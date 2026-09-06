import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
mkdirSync(resolve(root, 'cache'), { recursive: true });
const env = { ...process.env };
env.WORKBENCH_TEST_NODE = process.execPath;
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
const evidence = { timestamp: new Date().toISOString(), results, blocked: [
  { scenario: '模型编辑、真实审批及活动 Turn 下 Renderer/Main/Manager Kill', status: 'BLOCKED/NOT RUN', reason: '隔离测试未配置可用 Provider Profile 与凭据；本地持久化 fixture 不替代真实活动 Turn' },
  { scenario: 'Provider SSE 中断与 Stage Budget 恢复', status: 'BLOCKED/NOT RUN', reason: '需要兼容的真实 Provider；当前未配置' },
] };
writeFileSync(resolve(root, 'release-evidence/agent-manager-integration.json'), JSON.stringify(evidence, null, 2));
mkdirSync(resolve(root, 'release-evidence/failure-injection'), { recursive: true });
writeFileSync(resolve(root, 'release-evidence/failure-injection/process-boundaries.json'), JSON.stringify(evidence, null, 2));
process.exitCode = results.some(r => r.exitCode !== 0) ? 1 : 0;
