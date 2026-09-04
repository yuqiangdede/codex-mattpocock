import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, "apps/desktop/main/src/index.ts"),
        output: {
          entryFileNames: "index.js",
        },
      },
    },
  },
  preload: {
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
    build: {
      rollupOptions: {
        input: resolve(__dirname, "apps/desktop/renderer/index.html"),
      },
    },
  },
});
