# 使用 Project Scope Trust 与受保护边界

MVP 提供 Safe Mode 和默认的 Project Full Access，不提供机器级 Unrestricted 模式。Project Trust 可撤销并由新 Task 显式显示和继承，但敏感文件、工作区外路径以及除已授权 Model Provider/Connector 读取之外的网络访问仍需具体 Approval；Provider Grant 和 Connector Grant 始终保持 Task Scope。命令输出在 Timeline 中只实时展示有上限的 Tail，完整内容按需读取并经过 ANSI、超长行和 Secret 安全处理。
