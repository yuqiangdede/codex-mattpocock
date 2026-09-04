---
title: Validate Provider Secret isolation with sentinel token
id: T-012
labels:
  - ready-for-agent
depends_on:
  - T-001
validates:
  - US-17, US-18, US-19, US-20, US-21, US-31
impacts: []
---

## Intent

用 sentinel token（唯一可检索的标记字符串）验证 Provider Secret 从受控认证 Helper 到 Codex Runtime 的传递链路，并确认 Renderer、Project Shell、日志、诊断包和继承环境均不泄露凭据。

## Acceptance Criteria

- Sentinel token 存放在 Workbench 私有配置目录（模拟 `.env`），设置最小文件 ACL。
- 受控认证 Helper 读取 Sentinel token 并只输出 Token 给 Codex Runtime。
- 以下位置均不包含 sentinel token（grep 检索为空）：
  - Renderer 进程环境
  - Project Shell 环境变量
  - 日志文件
  - 诊断包
  - Utility Process 继承的父进程环境（验证显式 allowlist 机制有效）
- Utility Process 环境使用显式 allowlist，不依赖父进程继承。
- 验证结果已保存到 `release-evidence/secret-isolation-report.json`。
- 如果凭据泄露，Spike 停止（停止条件 US-31）。

## Validation

- 检查 `release-evidence/secret-isolation-report.json` 存在且 JSON 格式正确。
- 验证 Report 中所有检查点（Renderer、Shell、日志、诊断包、继承环境）均为 clean（sentinel token 不可见）。
- 验证 ACL 设置记录存在。

## Impact Scope

- 新增 `release-evidence/secret-isolation-report.json`。
- 可能新增 `packages/runtime-codex/` 中的认证 Helper 脚本。
- 不修改已有文档。
