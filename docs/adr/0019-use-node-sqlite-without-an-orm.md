# 使用 node:sqlite 且不引入 ORM

Agent Manager 使用 `node:sqlite DatabaseSync`、参数化 SQL 和项目自有的顺序迁移器，不引入 ORM。数据库启用 WAL、外键、`synchronous=FULL`、Busy Timeout 和受信 Schema 防护，写入保持短事务；固定 Electron 版本的 Packaged Smoke Test 是发布 Gate。Storage Adapter 保持极薄，若发布前验证证明 `node:sqlite` 的 RC 实现不可用，则整体切换为 `better-sqlite3`，产品不同时捆绑两套驱动。
