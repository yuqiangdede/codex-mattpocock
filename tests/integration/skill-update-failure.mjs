/**
 * Skill 更新失败/离线故障注入：
 *   期望结果 — 使用最后验证 Bundle，不阻塞启动。
 *
 * 策略：模拟 Skill Bundle 管理器在以下故障场景下的行为：
 *   1. Skill 源不可达（离线）— 使用缓存的最后验证 Bundle
 *   2. Skill 内容校验失败 — 拒绝更新，保留旧版本
 *   3. 无缓存 Bundle 且源不可达 — 不阻塞启动，标记 Skill 为不可用
 *   4. 缓存文件损坏 — 优雅降级
 *   5. 远程恢复后自动更新缓存
 *   6. 多个 Skill 部分可用 — 不阻塞整体启动
 *
 * 本仓库 skills/bundled/ 是预留目录（仅 .gitkeep），没有实际的 Skill 管理
 * 代码。因此本脚本实现一个最小化的 Skill Bundle 管理器来验证故障恢复
 * 语义，与 release-gates.md 的期望结果对齐。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const cache = resolve('cache');
mkdirSync(cache, { recursive: true });

const tmpDir = mkdtempSync(join(cache, 'skill-update-failure-'));

function hash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

class SkillBundleStore {
  constructor(rootDir) {
    this.bundleDir = join(rootDir, 'bundles');
    this.cacheDir = join(rootDir, 'cache');
    this.verified = new Map();
    mkdirSync(this.bundleDir, { recursive: true });
    mkdirSync(this.cacheDir, { recursive: true });
  }

  fetchFromSource(id, content, version) {
    return { id, version, content, hash: hash(content), verified: false };
  }

  verifyBundle(bundle) {
    if (!bundle.id || !bundle.version || !bundle.content || !bundle.hash) return false;
    return hash(bundle.content) === bundle.hash;
  }

  saveVerified(bundle) {
    const verified = { ...bundle, verified: true };
    this.verified.set(bundle.id, verified);
    writeFileSync(join(this.cacheDir, `${bundle.id}.json`), JSON.stringify(verified, null, 2), 'utf8');
  }

  loadCached(id) {
    if (this.verified.has(id)) return this.verified.get(id);
    const cacheFile = join(this.cacheDir, `${id}.json`);
    if (!existsSync(cacheFile)) return null;
    try {
      return JSON.parse(readFileSync(cacheFile, 'utf8'));
    } catch {
      return null;
    }
  }

  loadSkill(id, fetchFn) {
    let remote = null;
    try {
      remote = fetchFn();
    } catch {
      remote = null;
    }

    if (remote && this.verifyBundle(remote)) {
      this.saveVerified(remote);
      return { bundle: remote, source: 'remote', degraded: false };
    }

    const cached = this.loadCached(id);
    if (cached) {
      return { bundle: cached, source: 'cached', degraded: true };
    }

    return { bundle: null, source: 'unavailable', degraded: true };
  }
}

// ── 测试 ──────────────────────────────────────────────────────────

const store = new SkillBundleStore(tmpDir);

// ── 1. 正常流程：远程获取 + 验证 + 缓存 ─────────────────────────
const skillA = store.fetchFromSource('skill-a', '# Skill A\n步骤1\n步骤2', '1.0.0');
assert.ok(store.verifyBundle(skillA), '正常 Bundle 应验证通过');
store.saveVerified(skillA);
assert.ok(store.loadCached('skill-a'), '缓存应存在');
console.log('PASS: 正常流程 — 远程获取 + 验证 + 缓存');

// ── 2. 源不可达（离线）— 使用最后验证 Bundle ───────────────────
const result2 = store.loadSkill('skill-a', () => {
  throw new Error('网络不可达');
});
assert.equal(result2.source, 'cached', '源不可达时应从缓存加载');
assert.ok(result2.bundle, '应有缓存 Bundle');
assert.equal(result2.bundle.id, 'skill-a');
assert.equal(result2.degraded, true, '应标记为降级模式');
console.log('PASS: 源不可达时使用最后验证 Bundle，标记降级');

// ── 3. Bundle 内容校验失败 — 拒绝更新，保留旧版本 ───────────────
const skillABad = store.fetchFromSource('skill-a', '# Skill A modified\n步骤1', '1.1.0');
skillABad.hash = 'invalid-hash';
assert.equal(store.verifyBundle(skillABad), false, '篡改的 Bundle 应验证失败');
const result3 = store.loadSkill('skill-a', () => skillABad);
assert.equal(result3.source, 'cached', '验证失败时应回退到缓存');
assert.equal(result3.bundle.version, '1.0.0', '应保留旧版本');
console.log('PASS: Bundle 校验失败时拒绝更新，保留旧版本');

// ── 4. 无缓存且源不可达 — 不阻塞启动 ────────────────────────────
const result4 = store.loadSkill('skill-nonexistent', () => {
  throw new Error('网络不可达');
});
assert.equal(result4.source, 'unavailable', '无缓存且不可达时应标记为不可用');
assert.equal(result4.bundle, null, '不应有 Bundle');
assert.equal(result4.degraded, true, '应标记为降级模式');
console.log('PASS: 无缓存且源不可达时不阻塞启动，标记为不可用');

// ── 5. 缓存文件损坏 — 优雅降级 ──────────────────────────────────
const skillB = store.fetchFromSource('skill-b', '# Skill B', '2.0.0');
store.saveVerified(skillB);
writeFileSync(join(tmpDir, 'cache', 'skill-b.json'), '{invalid json', 'utf8');
const freshStore = new SkillBundleStore(tmpDir);
const result5 = freshStore.loadSkill('skill-b', () => {
  throw new Error('网络不可达');
});
assert.equal(result5.source, 'unavailable', '缓存损坏且源不可达时应标记为不可用');
assert.equal(result5.bundle, null, '不应有 Bundle');
assert.equal(result5.degraded, true, '应标记为降级');
console.log('PASS: 缓存文件损坏时优雅降级，不阻塞启动');

// ── 6. 远程恢复后自动更新缓存 ──────────────────────────────────
const skillBNew = store.fetchFromSource('skill-b', '# Skill B updated', '2.1.0');
const result6 = store.loadSkill('skill-b', () => skillBNew);
assert.equal(result6.source, 'remote', '远程恢复后应从远程加载');
assert.equal(result6.bundle.version, '2.1.0', '应使用新版本');
assert.equal(result6.degraded, false, '不应标记为降级');
const cached6 = store.loadCached('skill-b');
assert.equal(cached6.version, '2.1.0', '新版本应已缓存');
console.log('PASS: 远程恢复后自动更新缓存');

// ── 7. 多个 Skill 部分可用 — 不阻塞整体启动 ─────────────────────
const results = [
  store.loadSkill('skill-a', () => { throw new Error('离线'); }),
  store.loadSkill('skill-b', () => skillBNew),
  store.loadSkill('skill-c', () => { throw new Error('离线'); }),
];
const available = results.filter(r => r.bundle !== null);
const unavailable = results.filter(r => r.bundle === null);
assert.equal(available.length, 2, '2 个 Skill 可用（1 缓存 + 1 远程）');
assert.equal(unavailable.length, 1, '1 个 Skill 不可用');
console.log('PASS: 多个 Skill 部分可用时不阻塞整体启动');
