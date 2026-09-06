import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { WorkbenchDatabase } from '../../packages/storage/dist/index.js';
mkdirSync(resolve('cache'), { recursive: true });
const file = join(mkdtempSync(resolve('cache/migration-failure-')), 'workbench.db');
const first = new WorkbenchDatabase(file);
first.insertProject({ id: 'p', name: '不可丢失', path: '.', toolchain: [], createdAt: '2026-09-06' });
first.close();
const future = new DatabaseSync(file);
future.exec('PRAGMA user_version=999');
future.close();
const recovery = new WorkbenchDatabase(file);
try {
  assert.match(recovery.recoveryReason, /版本/);
  assert.equal(recovery.listProjects()[0].name, '不可丢失');
  assert.throws(() => recovery.insertProject({ id: 'q', name: '拒绝写入', path: '.', toolchain: [], createdAt: '2026-09-06' }));
  console.log('PASS: 不支持的迁移版本进入只读 Recovery Mode；保留原数据并拒绝写入');
} finally { recovery.close(); }
