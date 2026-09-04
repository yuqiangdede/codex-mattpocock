# 隔离规划、实施与 Review Session

需求澄清、Spec 和 Ticket 共用父 Task 的规划 Runtime Session；需要隔离或并行的实施工作由各自 Child Task 的 Runtime Session 完成；最终 Review 使用新的独立 Session，只接收已批准 Spec、Ticket、最终 Diff、验证结果和 Project 约定。首个 Workflow 在 Spec 和最终 Review 设置人工 Gate，Spec 批准绑定内容哈希，内容变化后重新打开 Gate；Task 只有在验收标准具有 Completion Evidence、必要验证通过且不存在未解决 Approval 或 Uncertain Input 时才能 Completed。
