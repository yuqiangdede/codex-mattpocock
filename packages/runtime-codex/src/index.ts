/**
 * @workbench/runtime-codex
 *
 * Codex App Server lifecycle management and Runtime Session mapping.
 * One App Server process per Provider Profile, shared across Tasks.
 */

export { JsonRpcConnection } from "./jsonrpc.js";
export type {
  NotificationHandler,
  ServerRequestHandler,
  JsonRpcConnectionOptions,
} from "./jsonrpc.js";

export {
  CodexAppServer,
  CODEX_APP_SERVER_ARGS,
  textInput,
} from "./app-server.js";
export type { CodexAppServerOptions, SpawnFn } from "./app-server.js";

export { RuntimeSessionManager } from "./runtime-session.js";
export type {
  RuntimeSession,
  RuntimeSessionManagerOptions,
  OpenSessionRequest,
  ResumeSessionRequest,
} from "./runtime-session.js";

export { ProviderProfileStore } from "./provider-profile.js";
export type { ProviderProfile } from "./provider-profile.js";

export {
  ProviderSecretStore,
  buildAppServerEnv,
  stripSecretLikeEntries,
  writeCodexHomeConfig,
  CHILD_ENV_ALLOWLIST,
} from "./secret-helper.js";
