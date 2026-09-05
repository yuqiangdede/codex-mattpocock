import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

// Map workspace packages to their source so vite/rollup can resolve and bundle
// them regardless of node_modules linking.
const workbenchAliases = {
  "@workbench/shared": resolve(__dirname, "packages/shared/src/index.ts"),
  "@workbench/storage": resolve(__dirname, "packages/storage/src/index.ts"),
  "@workbench/git-worktree": resolve(__dirname, "packages/git-worktree/src/index.ts"),
};

export default defineConfig({
  main: {
    resolve: { alias: workbenchAliases },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "apps/desktop/main/src/index.ts"),
          "manager-bridge": resolve(__dirname, "apps/desktop/main/src/manager-bridge.ts"),
          "agent-manager": resolve(__dirname, "packages/agent-manager/src/index.ts"),
        },
        output: {
          entryFileNames: "[name].js",
        },
      },
    },
  },
  preload: {
    resolve: { alias: workbenchAliases },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "apps/desktop/preload/src/index.ts"),
        output: {
          entryFileNames: "index.js",
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "apps/desktop/renderer"),
    resolve: { alias: workbenchAliases },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "apps/desktop/renderer/index.html"),
      },
    },
  },
});
