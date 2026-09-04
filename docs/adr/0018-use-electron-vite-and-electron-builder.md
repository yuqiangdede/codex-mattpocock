# 使用 electron-vite 和 electron-builder

桌面端使用 Electron、React 和 TypeScript，采用 electron-vite 构建 Main、Preload 与 Renderer，采用 electron-builder 生成 Windows x64 的 Signed NSIS Installer 和 Signed Portable EXE。Installed Mode 支持签名自动更新但不在活动 Task 期间安装；Portable Mode 只检查并下载新签名 EXE，由用户退出后替换。Renderer 使用 TanStack Query 管理请求快照、版本化 Event Reducer 维护实时 Projection、Zustand 保存临时 UI 状态，Diff 使用懒加载且复用单实例的 Monaco Diff Editor。
