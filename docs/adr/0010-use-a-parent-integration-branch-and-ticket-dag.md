# 使用 Parent Integration Branch 和 Ticket DAG

Parent Task 拥有 Integration Branch，具有稳定 ID 的 Ticket 组成无环依赖图，`depends_on` 不引用可变标题或文件名；调度器只运行依赖已完成的 Ticket，并从满足依赖的确定 Commit 创建 Child Task Worktree。Child Task 的结果先进入 Integration Branch，失败只阻塞其后继 Ticket；最终 Review 针对完整 Integration Candidate，Review Finding 经用户选择后转化为新的修订 Ticket。
