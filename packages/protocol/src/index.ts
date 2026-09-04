/**
 * @workbench/protocol
 *
 * TypeScript types and JSON Schema for the Codex App Server protocol.
 * Will be generated from a pinned Codex Binary in T-003.
 * Currently a placeholder with the stable API surface declaration.
 */

/** Stable Codex App Server API methods (non-experimental) */
export const STABLE_API_METHODS = [
  "initialize",
  "thread/start",
  "thread/resume",
  "thread/fork",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "review/start",
] as const;

/** Experimental APIs excluded from MVP baseline */
export const EXCLUDED_EXPERIMENTAL_APIS = [
  "WebSocket transport",
  "process/*",
  "dynamic tools",
  "paginated history",
] as const;

/** Transport layer: stdio JSONL only */
export const TRANSPORT_LAYER = "stdio-jsonl" as const;
