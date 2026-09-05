import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// 为原有 18 项回归提供全新的隔离 Fixture，旧脚本清理范围仅落在本轮 cache 中。
const root = resolve(import.meta.dirname, '..');
mkdirSync(join(root, 'cache'), { recursive: true });
const runRoot = mkdtempSync(join(root, 'cache/m1-regression-'));
const fixture = join(runRoot, '.scratch/m1-fixture');
mkdirSync(fixture, { recursive: true });
mkdirSync(join(runRoot, '.scratch/m1-e2e'), { recursive: true });
writeFileSync(join(fixture, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --experimental-strip-types --test index.test.ts' } }));
writeFileSync(join(fixture, 'tsconfig.json'), '{}');
writeFileSync(join(fixture, 'index.ts'), '// 待实现\n');
writeFileSync(join(fixture, 'index.test.ts'), "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { hello } from './index.ts'; test('hello 返回预期值', () => assert.equal(hello(), 'hello world'));\n");
for (const args of [['init', '-b', 'main'], ['add', 'package.json', 'tsconfig.json', 'index.ts', 'index.test.ts'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']]) {
  execFileSync('git', args, { cwd: fixture, stdio: 'pipe' });
}
const result = spawnSync(process.execPath, [join(root, '.scratch/m1-e2e/verify.mjs')], { cwd: runRoot, stdio: 'inherit', timeout: 120_000, windowsHide: true });
if (result.error) console.error(result.error);
if (result.status === 0) copyFileSync(join(runRoot, 'release-evidence/m1-slice-e2e.json'), join(root, 'release-evidence/m1-slice-e2e.json'));
process.exitCode = result.status ?? 1;
