/**
 * Provider Profile 存储。
 *
 * 领域术语（CONTEXT.md）：Provider Profile 是一个可复用的 Model Provider
 * 配置，由服务地址、凭据引用和模型标识组成。它不含凭据本身——凭据只能
 * 经 `secret-helper` 的受控认证 Helper 读取。
 *
 * Profile 与 Secret 分文件存储：Profile 可安全展示给 Renderer，Secret 不行。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ProviderProfile {
  id: string;
  name: string;
  baseUrl: string;
  modelId: string;
  /** config.toml 的 env_key；子进程中承载凭据的环境变量名。 */
  secretEnvKey: string;
  /**
   * 目标 Provider 的线协议。
   *
   * 固定 Binary 0.153.2 只接受 `responses`：写成 `chat_completions` 会在
   * thread/start 时抛 `unknown variant`。因此仅支持 Chat Completions 的
   * 自建 Provider 无法与该版本 App Server 对接——这是选型约束，不是配置疏漏。
   */
  wireApi: "responses";
}

const DEFAULT_PROFILE_ID = "default";

export class ProviderProfileStore {
  constructor(private readonly configDir: string) {}

  private get filePath(): string {
    return join(this.configDir, "provider-profiles.json");
  }

  list(): ProviderProfile[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      return Array.isArray(parsed) ? (parsed as ProviderProfile[]) : [];
    } catch {
      return [];
    }
  }

  get(profileId: string): ProviderProfile | null {
    return this.list().find((profile) => profile.id === profileId) ?? null;
  }

  /** 未指定 Profile 时使用第一个可用配置。 */
  defaultProfile(): ProviderProfile | null {
    const profiles = this.list();
    return (
      profiles.find((profile) => profile.id === DEFAULT_PROFILE_ID) ??
      profiles[0] ??
      null
    );
  }

  save(profile: ProviderProfile): void {
    mkdirSync(this.configDir, { recursive: true });
    const others = this.list().filter((item) => item.id !== profile.id);
    writeFileSync(
      this.filePath,
      `${JSON.stringify([...others, profile], null, 2)}\n`,
      "utf8",
    );
  }
}
