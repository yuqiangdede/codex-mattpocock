# 分离 App 与 Codex Runtime 更新链

App 发布物与首次下载的 Codex Runtime Bundle 使用两条独立完整性链。App 的 NSIS、Portable EXE 和更新元数据使用稳定 Publisher Identity 签名；Codex Runtime 清单按平台与架构记录固定版本、完整 Bundle SHA256、官方地址和镜像，校验后原子切换并保留上一版本。Windows x64 的安装版和 Portable Packaged Smoke Test 必须实际验证 SQLite、Runtime 下载、App Server、中文及空格路径和退出清理后才能发布。
