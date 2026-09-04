# 限制 MVP Memory 并委托 Runtime 压缩

MVP 只包含 Runtime Context、Task Memory 和 Project Memory，不实现跨 Project 的 User Memory 或向量数据库。Project Memory 的长期修改必须通过可审查 Diff；Runtime Context 的自动和手动 Compaction 都由 Codex 执行，Workbench 只展示阈值、事件和结果，不自行总结或重写 Runtime 历史。
