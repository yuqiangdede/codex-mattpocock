# 分离 Task 的生命周期、执行与注意状态

Task 状态不使用包含所有组合的大枚举，而是分别记录 Task Lifecycle、Execution State 和 Attention State。Queued Input 持久化后按全局及 Provider Profile 并发上限公平调度；如果输入已发出但无法确认结果，则标记为 Uncertain Input，禁止静默重发，由用户检查现场后决定下一步。
