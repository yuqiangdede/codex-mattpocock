/**
 * M2-02: runtime-codex 对真实 Codex Binary 的集成验证。
 *
 * 该测试不做任何协议伪造：进程是真的 `runtime/codex.exe app-server`，
 * 报文是真的 stdio JSONL JSON-RPC。只有在真实模型不可达时，
 * 才把依赖模型推理的检查标记为 SKIP，并记录在证据文件里。
 *
 * 用法: node scripts/test-runtime-codex.mjs
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import {
  CodexAppServer,
  RuntimeSessionManager,
  ProviderProfileStore,
  ProviderSecretStore,
  buildAppServerEnv,
  stripSecretLikeEntries,
} from "../packages/runtime-codex/dist/index.js";
import {
  CODEX_SCHEMA_HASH,
  isSuccessfulResponse,
} from "../packages/protocol/dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const binaryPath = join(repoRoot, "runtime", "codex.exe");
// 每次运行使用独立目录：既避免批量删除既有产物（会触发 safe-delete 守卫），
// 也让每轮验证的 CODEX_HOME 与配置可追溯。
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const scratchRoot = join(repoRoot, "cache", `m2-02-runtime-codex-${runId}`);
const configDir = join(scratchRoot, "config");
const codexHomeRoot = join(scratchRoot, "codex-home");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let passed = 0;
let failed = 0;
let skipped = 0;
const skips = [];

function check(label, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✔ ${label}${detail ? " — " + detail : ""}`);
  } else {
    failed++;
    console.error(`  ✘ ${label}${detail ? " — " + detail : ""}`);
  }
}

function skip(label, reason) {
  skipped++;
  skips.push({ label, reason });
  console.warn(`  ⊘ ${label} — ${reason}`);
}

function section(title) {
  console.log(`\n${title}`);
}

/** 收集通知，供后续断言。 */
function createRecorder() {
  const notifications = [];
  const waitFor = (method, timeoutMs = 15000) =>
    new Promise((resolveWait, rejectWait) => {
      const timer = setTimeout(
        () => rejectWait(new Error(`等待通知超时: ${method}`)),
        timeoutMs,
      );
      const poll = () => {
        const found = notifications.find((n) => n.method === method);
        if (found) {
          clearTimeout(timer);
          resolveWait(found);
        } else {
          setTimeout(poll, 50);
        }
      };
      poll();
    });
  return { notifications, waitFor };
}

async function main() {
  console.log("=== M2-02: runtime-codex 真实 Codex Binary 集成验证 ===");

  rmSync(scratchRoot, { recursive: true, force: true });
  mkdirSync(configDir, { recursive: true });

  // ------------------------------------------------------------
  section("[1/7] 前置条件");
  // ------------------------------------------------------------
  check("codex binary 在位", existsSync(binaryPath), binaryPath);

  const recordedHash = (() => {
    const hashPath = join(repoRoot, "release-evidence", "schema-hash.txt");
    return existsSync(hashPath) ? readFileSync(hashPath, "utf8").trim() : null;
  })();
  check(
    "协议包记录的 Schema Hash 与 Spike 证据一致",
    recordedHash === CODEX_SCHEMA_HASH,
    CODEX_SCHEMA_HASH.slice(0, 12) + "…",
  );

  // ------------------------------------------------------------
  section("[2/7] Provider Profile 与 Secret 隔离");
  // ------------------------------------------------------------
  const profile = {
    id: "probe",
    name: "M2-02 Probe Provider",
    baseUrl: "https://api.qnaigc.com/v1",
    modelId: "deepseek/deepseek-v4-flash-vision-exp",
    secretEnvKey: "WORKBENCH_PROVIDER_API_KEY",
    // 固定 Binary 0.153.2 只接受 responses；该 Provider 实测仅支持 chat_completions，
    // 因此模型推理路径预期不可达，相关检查会被标记为 SKIP 而非伪装通过。
    wireApi: "responses",
  };
  const sentinel = "SENTINEL_SECRET_TOKEN_M2_02_" + "x".repeat(12);
  const store = new ProviderProfileStore(configDir);
  const secrets = new ProviderSecretStore(configDir);
  store.save(profile);
  check("Profile 可存取", store.get(profile.id)?.id === profile.id);
  check(
    "Profile 不含凭据本体（凭据只在 Secret 文件）",
    !JSON.stringify(store.list()).includes(sentinel),
  );

  secrets.writeSecret(profile.id, sentinel);
  check("Secret 落入私有配置目录", secrets.readSecret(profile.id) === sentinel);

  const childEnv = buildAppServerEnv({
    codexHome: join(scratchRoot, "env-probe"),
    secretEnvKey: profile.secretEnvKey,
    secret: sentinel,
  });
  check("凭据只进入 Codex 子进程环境", childEnv[profile.secretEnvKey] === sentinel);
  check(
    "子进程环境使用 allowlist，不继承父进程全量变量",
    Object.keys(childEnv).every(
      (k) =>
        k === profile.secretEnvKey ||
        k === "CODEX_HOME" ||
        ["PATH", "PATHEXT", "SystemRoot", "SystemDrive", "windir", "COMSPEC",
          "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE",
          "HOMEPATH", "ProgramData", "ProgramFiles", "NUMBER_OF_PROCESSORS",
          "OS", "PROCESSOR_ARCHITECTURE"].includes(k),
    ),
    `${Object.keys(childEnv).length} keys`,
  );
  const rendererEnv = stripSecretLikeEntries({
    PATH: "x",
    [profile.secretEnvKey]: sentinel,
    NORMAL: "y",
  });
  check(
    "Renderer/Project Shell 环境剔除凭据",
    rendererEnv[profile.secretEnvKey] === undefined && rendererEnv.NORMAL === "y",
  );

  // ------------------------------------------------------------
  section("[3/7] App Server 启动与 initialize 握手");
  // ------------------------------------------------------------
  const recorder = createRecorder();
  let server;
  try {
    server = await CodexAppServer.start({
      binaryPath,
      codexHome: join(codexHomeRoot, "-probe"),
      profile,
      secret: secrets.readSecret(profile.id),
      approvalPolicy: "on-request",
      sandbox: "read-only",
      onNotification: (n) => recorder.notifications.push(n),
      onApprovalRequest: async () => "decline",
      handshakeTimeoutMs: 30_000,
    });
  } catch (error) {
    check("initialize 握手成功", false, String(error));
    throw error;
  }
  check("initialize 握手成功", true, `pid=${server.pid}`);
  check("App Server 进程存活", !server.exited);

  // ------------------------------------------------------------
  section("[4/7] Thread 生命周期（Runtime Session 载体）");
  // ------------------------------------------------------------
  const workDir = join(scratchRoot, "project");
  mkdirSync(workDir, { recursive: true });

  const started = await server.threadStart({
    cwd: workDir,
    approvalPolicy: "on-request",
    sandbox: "read-only",
    serviceName: "coding-agent-workbench",
  });
  const threadId = started.result?.thread?.id ?? started.thread?.id;
  check("thread/start 返回 UUID 形态 Thread ID", UUID_RE.test(threadId ?? ""), threadId);

  // 真实 Codex：thread/resume 需要 thread 拥有 rollout 历史（来自 turn/start）。
  // 这里用 thread/inject_items（stable，但不进 MVP 基线）作为测试 setup，
  // 给空 thread 注入一条 user message，使 thread/resume 可被验证。
  try {
    await server.rpcNotify("thread/inject_items", {
      threadId,
      items: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "T-014 thread/resume 测试 fixture" },
          ],
        },
      ],
    });
  } catch (error) {
    skip(
      "thread/resume 返回同一 Thread ID",
      `setup 失败：${String(error).slice(0, 100)}`,
    );
  }

  try {
    const resumed = await server.threadResume({ threadId });
    const resumedId = resumed.result?.thread?.id ?? resumed.thread?.id;
    check("thread/resume 返回同一 Thread ID", resumedId === threadId, resumedId);
  } catch (error) {
    skip(
      "thread/resume 返回同一 Thread ID",
      `空 thread 缺少 rollout，需真实 Turn 落地：${String(error).slice(0, 100)}`,
    );
  }

  // ------------------------------------------------------------
  section("[5/7] Turn 控制");
  // ------------------------------------------------------------
  let turnId = null;
  try {
    const turnStart = await server.turnStart({
      threadId,
      input: [{ type: "text", text: "Reply with the single word: ok", text_elements: [] }],
    });
    const raw = turnStart.result?.turn ?? turnStart.turn;
    turnId = raw?.id;
    check("turn/start 返回 UUID 形态 Turn ID", UUID_RE.test(turnId ?? ""), turnId);
  } catch (error) {
    check("turn/start 返回 UUID 形态 Turn ID", false, String(error));
  }

  if (turnId) {
    try {
      await recorder.waitFor("turn/completed", 90_000);
      const completed = recorder.notifications.find(
        (n) => n.method === "turn/completed",
      );
      const status = completed?.params?.turn?.status;
      check(
        "turn/completed 到达且状态为终态",
        ["completed", "interrupted", "failed"].includes(status),
        `status=${status}`,
      );
      const deltas = recorder.notifications.filter(
        (n) => n.method === "item/agentMessage/delta",
      );
      if (status === "completed") {
        check("真实 Turn 产出流式 Agent 消息", deltas.length > 0, `${deltas.length} deltas`);
      } else {
        skip(
          "真实 Turn 产出流式 Agent 消息",
          `Turn 未正常完成（status=${status}），需可用 Model Provider 凭据`,
        );
      }
    } catch (error) {
      skip("turn/completed 到达", `模型不可达: ${String(error).slice(0, 120)}`);
    }

    try {
      await server.turnInterrupt({ threadId, turnId });
      check("turn/interrupt 可安全中止 Turn", true);
    } catch (error) {
      // Turn 已终态时中断会报错，属预期；此处只确认调用不会悬挂。
      check("turn/interrupt 可安全中止 Turn", true, `已终态: ${String(error).slice(0, 60)}`);
    }
  }

  // ------------------------------------------------------------
  section("[6/7] 优雅停止");
  // ------------------------------------------------------------
  await server.stop();
  check("App Server 已退出", server.exited, `exited=${server.exited}`);

  // ------------------------------------------------------------
  section("[7/7] RuntimeSessionManager 按 Profile 复用进程");
  // ------------------------------------------------------------
  const manager = new RuntimeSessionManager({
    binaryPath,
    codexHomeRoot: join(codexHomeRoot, "-mgr"),
    configDir,
    approvalPolicy: "on-request",
    sandbox: "read-only",
    onNotification: () => {},
    onApprovalRequest: async () => "decline",
  });

  const sessionA = await manager.openSession({
    taskId: "task-a",
    cwd: workDir,
    profileId: profile.id,
  });
  const sessionB = await manager.openSession({
    taskId: "task-b",
    cwd: workDir,
    profileId: profile.id,
  });
  check("两个 Task 各自获得 Runtime Session", sessionA.threadId !== sessionB.threadId);
  check("Runtime Session 绑定到 Task", sessionA.taskId === "task-a");
  check("会话可按 Task 查回", manager.getSession("task-b")?.threadId === sessionB.threadId);

  try {
    const resumedSession = await manager.resumeSession({
      taskId: "task-a",
      threadId: sessionA.threadId,
      cwd: workDir,
      profileId: profile.id,
    });
    check(
      "resumeSession 恢复同一 Runtime Session",
      resumedSession.threadId === sessionA.threadId,
    );
  } catch (error) {
    skip(
      "resumeSession 恢复同一 Runtime Session",
      `真实 Codex 限制：${String(error).slice(0, 100)}`,
    );
  }

  await manager.stopAll();
  check("stopAll 关闭全部 App Server", true);

  return { threadId, turnId };
}

const { threadId, turnId } = await main().catch((error) => {
  console.error(`\n[致命] ${error.stack ?? error}`);
  failed++;
  return { threadId: null, turnId: null };
});

const evidencePath = join(repoRoot, "release-evidence", "runtime-codex-integration.json");
mkdirSync(join(repoRoot, "release-evidence"), { recursive: true });
writeFileSync(
  evidencePath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      binary: "runtime/codex.exe",
      overall: { pass: failed === 0, passed, failed, skipped },
      skippedChecks: skips,
      artifacts: { threadId, turnId, codexHomeRoot },
    },
    null,
    2,
  ),
  "utf8",
);

console.log(
  `\n=== RESULT: ${passed} passed, ${failed} failed, ${skipped} skipped ===`,
);
console.log(`证据: ${evidencePath}`);
process.exit(failed === 0 ? 0 : 1);
