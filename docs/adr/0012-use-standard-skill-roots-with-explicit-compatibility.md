# 使用标准 Skill Root 和显式兼容来源

Workbench 以 Codex 官方 `.agents/skills` 仓库层级及用户目录为规范 Skill 来源，并允许用户显式添加外部 Root；`.codex/skills`、`.claude/skills` 等目录作为标明来源的兼容入口，不静默合并或覆盖同名 Skill。每次启动在后台检查上游 `main`，发现新 Commit 后下载到新的不可变 Bundle 目录并核对许可证、文件清单、依赖和 Smoke Test；普通更新验证通过后只成为新 Task 的默认版本，许可证变化、新增脚本或外部依赖则必须人工批准，离线或检查失败时继续使用最后一个已验证 Bundle。Task 始终保存 Skill Snapshot；Project/User Skill 首次执行及内容变化后必须重新确认信任。
