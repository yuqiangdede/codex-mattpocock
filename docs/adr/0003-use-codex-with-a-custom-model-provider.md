# 使用 Codex Runtime 连接自建 Model Provider

首版只使用 Codex App Server 作为 Agent Runtime，不自研 Agent loop，也不接入第二种 Agent Runtime。用户可以通过 Provider Profile 把 Codex 的模型推理指向兼容 OpenAI Responses API、支持 Streaming 和 Tool Calling 的自建 Model Provider；Task 创建后固定使用所选 Provider 和模型。
