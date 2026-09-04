# 显示可审查的 Context Manifest

Workbench 不把自动上下文选择做成黑盒。每个 Runtime Session 都显示 Context Manifest，区分 Project 约定和 Workflow Artifact 等 Locked 来源、Agent 自动建议、用户固定、用户补充与用户排除；固定与排除项在 Task 内持续有效，自动建议按 Stage 重算且不能绕过排除。文件与目录项记录路径和哈希并在 Turn 发送前复核，变化时标记 STALE；图片复制到按内容哈希去重的 Task 内容存储，只有用户导出时才写入 Project。
