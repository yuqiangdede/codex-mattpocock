/**
 * Provider Secret 的受控认证 Helper。
 *
 * 领域约束（CONTEXT.md）：Provider Secret 保存在 Workbench 私有配置目录、
 * 由受控认证 Helper 读取，不属于任何目标 Project，也不向 Renderer 或
 * Agent Shell 暴露。
 *
 * T-012 已用 sentinel token 验证的隔离检查点：
 * - 凭据只出现在 Codex App Server 子进程环境
 * - Utility Process 环境使用显式 allowlist，不依赖父进程继承
 * - Renderer 环境、Project Shell 环境、日志、诊断包均不得出现凭据
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SandboxMode, ApprovalPolicy } from "@workbench/protocol";
import type { ProviderProfile } from "./provider-profile.js";

/**
 * 子进程环境 allowlist。不继承父进程环境，避免把 Workbench 自身的
 * 变量（含任何误入的凭据）带进 Agent Runtime。
 */
export const CHILD_ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "SystemDrive",
  "windir",
  "COMSPEC",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "ProgramData",
  "ProgramFiles",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PROCESSOR_ARCHITECTURE",
] as const;

/** 名称命中的环境变量一律剔除，兜住 allowlist 之外的凭据意外。 */
const SECRET_NAME_PATTERN = /token|secret|password|api[_-]?key|authorization|credential/i;

export class ProviderSecretStore {
  constructor(private readonly configDir: string) {}

  private get filePath(): string {
    return join(this.configDir, "provider-secrets.json");
  }

  /**
   * 读取某个 Profile 的凭据。文件缺失或格式错误返回 null，不抛异常——
   * 没有凭据时 App Server 仍可启动并完成握手，只是无法执行模型 Turn。
   */
  readSecret(profileId: string): string | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Record<
        string,
        unknown
      >;
      const value = parsed[profileId];
      return typeof value === "string" && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  writeSecret(profileId: string, secret: string): void {
    mkdirSync(this.configDir, { recursive: true });
    let existing: Record<string, unknown> = {};
    if (existsSync(this.filePath)) {
      try {
        existing = JSON.parse(readFileSync(this.filePath, "utf8")) as Record<
          string,
          unknown
        >;
      } catch {
        existing = {};
      }
    }
    writeFileSync(
      this.filePath,
      `${JSON.stringify({ ...existing, [profileId]: secret }, null, 2)}\n`,
      "utf8",
    );
  }
}

/**
 * 构造 Codex App Server 子进程环境。
 *
 * 只保留 allowlist + CODEX_HOME + （唯一）凭据变量；命中 SECRET_NAME_PATTERN
 * 的父进程变量一律剔除。返回的对象不含其它 Workbench 状态。
 */
export function buildAppServerEnv(options: {
  codexHome: string;
  secretEnvKey?: string;
  secret?: string | null;
  /** 额外注入，供测试隔离使用（如 WORKBENCH_CODEX_FIXTURE）。 */
  extra?: Record<string, string>;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.CODEX_HOME = options.codexHome;
  if (options.secretEnvKey && options.secret) {
    env[options.secretEnvKey] = options.secret;
  }
  for (const [key, value] of Object.entries(options.extra ?? {})) {
    env[key] = value;
  }
  return env;
}

/** 从任意环境快照中剔除疑似凭据项，用于 Renderer / Project Shell。 */
export function stripSecretLikeEntries(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_NAME_PATTERN.test(key)) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * 在隔离的 CODEX_HOME 写入 App Server 配置。
 *
 * 隔离 CODEX_HOME 是本工单的硬要求：绝不能读写用户个人的 ~/.codex，
 * 否则会带上其私有登录态与 danger-full-access 配置。
 */
export function writeCodexHomeConfig(options: {
  codexHome: string;
  profile: ProviderProfile;
  model?: string;
  approvalPolicy: ApprovalPolicy;
  sandbox: SandboxMode;
}): void {
  const { codexHome, profile } = options;
  mkdirSync(codexHome, { recursive: true });
  const config = [
    `model = "${profile.modelId}"`,
    `model_provider = "${profile.id}"`,
    "",
    "[model_providers." + profile.id + "]",
    `name = "${profile.name}"`,
    `base_url = "${profile.baseUrl}"`,
    `env_key = "${profile.secretEnvKey}"`,
    `wire_api = "${profile.wireApi}"`,
    "",
  ].join("\n");
  writeFileSync(join(codexHome, "config.toml"), config, "utf8");
}
