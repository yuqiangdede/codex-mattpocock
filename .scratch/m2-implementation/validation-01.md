# M2-01 验证记录

基点：`5d9f95a30a8eef4d5a0313c500a2f8118d87893e`。日期：2026-09-05。

## 基线

- `node node_modules/typescript/bin/tsc --build`：退出 0。
- `node node_modules/electron-vite/bin/electron-vite.js build`：退出 0。
- `node .scratch/m1-e2e/verify.mjs`：18 passed / 0 failed，退出 0。
- `WORKBENCH_SMOKE_TEST=1` 启动项目 Electron：退出 0。
- `pnpm build` 曾触发依赖解析，公司镜像 DNS 报 ENOTFOUND；停止后使用已有本地依赖完成验证，没有更改镜像或升级依赖。

## RED → GREEN

1. 真实 Utility Process 客户端测试先因入口未实现失败；新增消息客户端、子进程入口及业务迁移后通过。
2. Main 不得持有 storage/git-worktree 的架构约束先失败；移除 Main 业务代码和依赖后通过。
3. 重复投递同一 Project Scan 得到两个 Project，断言 `2 !== 1`；加入响应缓存、ACK 释放与请求高水位后通过。
4. 正常退出后 Task 仍为 RUNNING，断言失败；增加退出中断落盘后通过。
5. 强杀 Main 后遗留 RUNNING，断言失败；增加重开时最小保护后通过。
6. Standards 审查指出中断状态与事件非原子。用真实 SQLite 唯一键冲突复现事件失败但状态已变 INTERRUPTED；将状态更新并入 appendEvent 事务后，状态、事件和 Projection 回滚检查通过。

## 最终验证入口

`./scripts/verify.ps1 -Gate all`：退出 0。类型检查与构建通过；原有 M1 18/18；真实事务回滚通过；6 组跨进程场景通过；Electron 冒烟退出 0。日志：`logs/m2-01-final-verification.log`。

其中 Spike 13/13 是原有证据文件检查，不表示本轮重跑了 Provider、安装包等现场测试。后续可用 `./scripts/verify.ps1 -Gate integration` 只运行本次相关验证。

最终 Fixture 改为实际调用 `hello()` 校验返回值后，再次运行 `-Gate integration`，退出 0；日志：`logs/m2-01-final-integration.log`。结束后检查无遗留 Electron 进程。

机器可读跨进程报告：`release-evidence/agent-manager-integration.json`。该报告包含时间、各套件退出码与输出，由每次验证重新生成。测试使用项目 cache 下独立 Fixture。

## 审查与边界

- Standards：首次发现 1 项 P2（中断状态/事件非事务），已修复并增加真实失败回滚验证，独立复核通过，剩余阻断项 0。
- Spec：01 工单核心要求有实现及测试覆盖。Preload 和 Renderer 源码未改变。
- ADR-0015 正常退出路径遵循先持久化后退出。强杀 Main 在 Windows/Electron 下可能同时终止 Utility Process，无法保证退出回调执行；实测验收为无残留子进程，重开标记 INTERRUPTED / UNCERTAIN，不重放输入。
- 本工单没有实现真实 Codex Runtime、完整事件重建/Uncertain Input 决策界面或自动恢复；分别留给 02、03 工单。
- NSIS、Portable、完整安全门禁、全新机器安装、人工 UI 操作：NOT RUN。
