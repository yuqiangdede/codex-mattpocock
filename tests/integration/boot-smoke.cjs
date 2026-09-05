const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// 冒烟使用独立数据目录，避免触碰用户已有 Task 和应用实例。
const root = path.resolve(__dirname, '../..');
const dataDir = fs.mkdtempSync(path.join(root, 'cache/manager-smoke-'));
app.setPath('userData', dataDir);
process.env.WORKBENCH_SMOKE_TEST = '1';
require('../../out/main/index.js');
