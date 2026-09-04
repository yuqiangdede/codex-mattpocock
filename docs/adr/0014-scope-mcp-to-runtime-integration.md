# 将 MVP MCP 限定为 Runtime 集成

MVP 发现并展示 Codex 已配置的 MCP Connector、连接状态、调用事件和审批，不建设 Connector 市场，也不让首个 Workflow 依赖 MCP。Task 首次读取 Connector 数据时记录 Connector Grant；写入、发送消息、创建资源等外部副作用仍需逐次批准。
