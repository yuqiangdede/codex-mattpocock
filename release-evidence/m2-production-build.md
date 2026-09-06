# M2 Production Build Verification

**Date:** 2026-09-06
**Commit:** a880c82
**Builder:** electron-builder 25.1.8, Electron 35.7.5

## Build artifacts

| Artifact | Size | Status |
|----------|------|--------|
| NSIS Installer (`Coding Agent Workbench-0.0.0-x64.exe`) | 81.83 MB | PASS |
| Portable EXE (`Coding Agent Workbench-0.0.0-x64-portable.exe`) | 81.62 MB | PASS |
| win-unpacked (`Coding Agent Workbench.exe`) | 191.91 MB | PASS |
| app.asar | 0.51 MB (74 files) | PASS |
| builder-debug.yml | 6,283 bytes | PASS |
| latest.yml | auto-update manifest | PASS |

## app.asar content verification

All critical source files present in the asar archive:

- `out/main/index.js` — Electron main entry
- `out/main/agent-manager.js` — Agent Manager service bundle
- `out/main/manager-bridge.js` — Utility Process bridge
- `out/preload/index.js` — Preload script
- `out/renderer/index.html` — Renderer HTML
- `out/renderer/assets/index-Cwqe8rdV.js` — Renderer JS bundle
- `packages/shared/dist/index.js`
- `packages/storage/dist/index.js`
- `packages/protocol/dist/index.js`
- `packages/git-worktree/dist/index.js`
- `packages/runtime-codex/dist/index.js`
- `packages/agent-manager/dist/index.js`
- `packages/workflow/dist/index.js`

## Smoke test

```
WORKBENCH_SMOKE_TEST=1 "dist-release-m2/win-unpacked/Coding Agent Workbench.exe" --no-sandbox --disable-gpu
```

Result:
- `[smoke] managerReady=true windowCreated=true managerPid=44176`
- Exit code: 0
- SQLite experimental warning (expected for node:sqlite in Electron 35)
- GPUCache data_3 open error (cosmetic, GPU disabled in headless)

**Smoke test: PASS**

## Build configuration

- `npmRebuild: false` — skipped native dependency rebuild (cross-platform codex binaries cause ENOENT on Windows)
- `signtoolOptions: null`, `forceCodeSigning: false` — unsigned build (development)
- NSIS: `oneClick: false`, `allowToChangeInstallationDirectory: true`, `perMachine: false`
- Portable: standard electron-builder portable target

## Known limitations

1. **Unsigned**: executables are not code-signed (development build)
2. **npmRebuild skipped**: `@electron/rebuild` fails because `@openai/codex-darwin-arm64` is an optional dependency not installed on Windows; the win32-x64 binary is correctly bundled via `@openai/codex-win32-x64`
3. **GPUCache error**: cosmetic only, caused by `--disable-gpu` flag in headless smoke test
