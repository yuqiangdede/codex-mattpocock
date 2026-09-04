/**
 * Preload script — runs in an isolated context with access to a limited
 * subset of Node APIs. Exposes a typed, whitelisted API to the Renderer
 * via contextBridge.
 *
 * Security: contextIsolation=true, sandbox=true, nodeIntegration=false.
 * Only explicitly whitelisted methods are exposed.
 */

const api = {
  /** Placeholder — real IPC channels will be added per ADR-0015 */
  version: "0.0.0",
} as const;

export type PreloadAPI = typeof api;
