---
title: Prove the Windows provider and storage packaging baseline
labels:
  - wayfinder:research
parent: map.md
blocking: []
status: closed
---

## Question

在目标 Electron 版本与 Windows x64 上，能否用 `node:sqlite` 在 Packaged Utility Process 中满足 WAL、完整性、迁移和恢复的最低要求，同时从受控认证 Helper 向固定 Codex Runtime 提供自建 Responses-compatible Provider 凭据而不泄露到 Renderer 或 Project Shell？输出最小可复现 Spike、制品形态和回退结论。

## Resolution

未通过，且尚未开始实测。仓库没有 Electron 工程、Node/Electron 版本锁、打包配置、Provider Helper、私有 ACL 或 Windows 制品；因此无法证明 `node:sqlite` 可在 Packaged Utility Process 中使用，也无法证明凭据隔离。`node:sqlite` 的 `DatabaseSync` 仍属 RC 稳定性，Utility Process 默认继承父进程环境；实现必须显式 allowlist 环境，不能把 Secret 放入继承环境。下一步是一个固定版本的 Windows x64 Spike：分别启动 NSIS 与 Portable，验证 Utility Process 中的 SQLite WAL/事务/并发读取，并以 sentinel token 验证 helper 到 Authorization 的链路以及 Renderer、Project Shell、日志、诊断包和继承环境均不泄露凭据。该 Spike 即使通过，也不替代 M2 恢复 Gate 或 M5 签名/发布 Gate。

参考：[Electron Utility Process](https://www.electronjs.org/docs/latest/api/utility-process)、[Node SQLite](https://nodejs.org/api/sqlite.html)、[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)。
