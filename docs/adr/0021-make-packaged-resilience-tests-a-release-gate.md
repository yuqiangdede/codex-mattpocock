# 将 Packaged、故障与安全测试设为 Release Gate

产品保持语言无关，但发布 Fixture 至少覆盖 TypeScript/npm、Java/Maven 和 Python/pyproject，并在确定性 Fixture 之外完成一次自身仓库 Dogfooding。Release Gate 包含 NSIS 与 Portable 真机启动、1000 Task 与长 Timeline 性能预算、主动终止各进程、Provider 断流与重复 Event、SQLite 迁移失败、Queue 不确定状态、Git 冲突、Windows 特殊路径、IPC/CSP/路径越界/Secret/Approval/签名等负向安全测试。产品不自动上传 Telemetry；用户只能在预览脱敏内容后主动导出 Diagnostic Bundle。
