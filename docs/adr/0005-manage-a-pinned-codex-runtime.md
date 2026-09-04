# 由应用管理固定版本的 Codex Runtime

应用不依赖用户全局安装的 Codex。首次运行时根据产品清单把固定版本的 Codex Binary 下载到应用管理的 `runtime/`，清单同时提供 SHA256、官方地址、可选镜像和离线导入能力。新旧版本并存，新版本通过协议 Smoke Test 后才切换，失败则回滚；应用始终使用与 Binary 同版本生成的协议类型和 Schema。
