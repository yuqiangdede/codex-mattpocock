# 隔离 Renderer、Main 与 Agent Manager

Renderer 启用 Context Isolation 和 Sandbox、禁用 Node Integration，只通过白名单 Preload API 通信。Electron Main 管理窗口、托盘和原生对话框，并使用 `utilityProcess.fork()` 启动及监督独立 Node.js Agent Manager；双方通过带协议版本、消息 ID、请求 ID、ACK 和去重语义的 `parentPort`/`MessagePort` Envelope 通信，stdout/stderr 只承载日志。只有 Agent Manager 能访问 SQLite、Git、Project 文件和 Codex App Server。Main 连接丢失后，Agent Manager 安全中断活动 Turn、持久化状态并退出，应用重开后恢复。
