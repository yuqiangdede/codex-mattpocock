# 隔离 Provider Secret 与 Agent Shell

Provider Secret 保存在 Workbench 私有配置目录的 `.env`，不写入目标 Project。Codex 通过受控的 command-backed authentication Helper 获取 Token；Renderer、Project 进程和 Agent Shell 不继承该 Secret。Portable Mode 的导出与备份默认排除私有 `.env`，在新机器上要求重新配置。
