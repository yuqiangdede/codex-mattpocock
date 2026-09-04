/**
 * T-004: Codex App Server Thread lifecycle trace collector (sanitized).
 *
 * Validates thread/start, thread/resume, and thread/fork through the stdio
 * JSONL boundary. The probe injects one fixed local history item to persist
 * the new Thread, but never starts a Turn or makes a model/Rollout request.
 *
 * Usage: node scripts/spike/thread-lifecycle-trace.mjs
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..", "..");
const codexPath = join(projectRoot, "runtime", "codex.exe");
const traceDir = join(projectRoot, "release-evidence", "protocol-trace");
const traceFile = join(traceDir, "thread-lifecycle-trace.jsonl");
const isolatedCodexHome = join(projectRoot, "cache", "t004-thread-lifecycle-home");

const secretKeyPattern = /token|secret|password|api[_-]?key|authorization|originurl/i;
const secretValuePatterns = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
];
const threadIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeString(value) {
  let sanitized = value
    .replaceAll(projectRoot, "<PROJECT_ROOT>")
    .replaceAll(isolatedCodexHome, "<ISOLATED_CODEX_HOME>")
    .replace(/C:\\Users\\[^\\\"\s]+/gi, "<USER_HOME>");

  for (const pattern of secretValuePatterns) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }

  return sanitized;
}

function sanitize(value, key = "") {
  if (secretKeyPattern.test(key)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitize(entryValue, entryKey),
      ]),
    );
  }

  return value;
}

function isSuccessfulResponse(response) {
  return response && typeof response === "object" && "result" in response && !("error" in response);
}

function assertThreadId(value, label) {
  if (typeof value !== "string" || !threadIdPattern.test(value)) {
    throw new Error(`${label} did not return a UUID-shaped Thread ID.`);
  }
}

function createChildEnvironment() {
  const environment = { ...process.env, CODEX_HOME: isolatedCodexHome };

  // 防止继承的凭据意外影响此无模型调用的本地协议探测。
  for (const key of Object.keys(environment)) {
    if (secretKeyPattern.test(key)) {
      delete environment[key];
    }
  }

  return environment;
}

async function collectLifecycleTrace() {
  mkdirSync(traceDir, { recursive: true });
  mkdirSync(isolatedCodexHome, { recursive: true });

  const trace = [];
  const pending = new Map();
  const proc = spawn(codexPath, ["app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: createChildEnvironment(),
  });

  let nextRequestId = 1;
  let stdoutBuffer = "";
  let closed = false;

  const close = async () => {
    if (closed) {
      return;
    }

    closed = true;
    proc.stdin.end();
    await new Promise((resolveExit) => proc.once("exit", resolveExit));
  };

  const record = (direction, message) => {
    trace.push({
      _direction: direction,
      _sanitized: true,
      ...sanitize(message),
    });
  };

  const request = (method, params, traceOperation = true) => {
    const id = nextRequestId++;
    const message = { id, method, params };

    if (traceOperation) {
      record("client-to-server", message);
    }

    return new Promise((resolveResponse, rejectResponse) => {
      pending.set(id, { resolveResponse, rejectResponse, traceOperation });
      proc.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          pending.delete(id);
          rejectResponse(error);
        }
      });
    });
  };

  proc.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line) {
        continue;
      }

      try {
        const response = JSON.parse(line);
        const pendingRequest = pending.get(response.id);
        if (!pendingRequest) {
          continue;
        }

        pending.delete(response.id);
        if (pendingRequest.traceOperation) {
          record("server-to-client", response);
        }
        pendingRequest.resolveResponse(response);
      } catch (error) {
        for (const { rejectResponse } of pending.values()) {
          rejectResponse(error);
        }
        pending.clear();
      }
    }
  });

  proc.stderr.on("data", (chunk) => {
    console.error(`[app-server] ${sanitizeString(chunk.toString("utf8")).trim()}`);
  });

  const processExit = new Promise((resolveExit, rejectExit) => {
    proc.once("error", rejectExit);
    proc.once("exit", (code, signal) => {
      if (!closed && code !== 0) {
        rejectExit(new Error(`App Server exited unexpectedly (code=${code}, signal=${signal}).`));
        return;
      }
      resolveExit();
    });
  });

  try {
    const initialize = await request(
      "initialize",
      {
        clientInfo: { name: "workbench-spike", title: "Workbench Spike", version: "0.0.1" },
        capabilities: { experimentalApi: false, requestAttestation: false },
      },
      false,
    );
    if (!isSuccessfulResponse(initialize)) {
      throw new Error(`initialize failed: ${JSON.stringify(sanitize(initialize))}`);
    }

    proc.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);

    const started = await request("thread/start", {
      cwd: projectRoot,
      approvalPolicy: "on-request",
      sandbox: "read-only",
      serviceName: "workbench-spike",
    });
    if (!isSuccessfulResponse(started)) {
      throw new Error(`thread/start failed: ${JSON.stringify(sanitize(started))}`);
    }

    const sourceThreadId = started.result?.thread?.id;
    assertThreadId(sourceThreadId, "thread/start");

    // 固定历史项仅用于让 Thread 持久化；不会启动 Turn 或请求模型。
    const injected = await request("thread/inject_items", {
      threadId: sourceThreadId,
      items: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "T-004 lifecycle persistence marker; no model turn." }],
        },
      ],
    });
    if (!isSuccessfulResponse(injected)) {
      throw new Error(`thread/inject_items failed: ${JSON.stringify(sanitize(injected))}`);
    }

    const resumed = await request("thread/resume", { threadId: sourceThreadId });
    if (!isSuccessfulResponse(resumed)) {
      throw new Error(`thread/resume failed: ${JSON.stringify(sanitize(resumed))}`);
    }

    const resumedThreadId = resumed.result?.thread?.id;
    if (resumedThreadId !== sourceThreadId) {
      throw new Error("thread/resume did not reuse the Thread ID returned by thread/start.");
    }

    const forked = await request("thread/fork", { threadId: sourceThreadId });
    if (!isSuccessfulResponse(forked)) {
      throw new Error(`thread/fork failed: ${JSON.stringify(sanitize(forked))}`);
    }

    const forkedThreadId = forked.result?.thread?.id;
    assertThreadId(forkedThreadId, "thread/fork");
    if (forkedThreadId === sourceThreadId) {
      throw new Error("thread/fork reused the source Thread ID instead of creating a derived Thread.");
    }
    if (forked.result?.thread?.forkedFromId !== sourceThreadId) {
      throw new Error("thread/fork did not identify the source Thread through forkedFromId.");
    }

    trace.push({
      _direction: "validation",
      _sanitized: true,
      result: "passed",
      startThreadId: sourceThreadId,
      resumedThreadId,
      forkedThreadId,
      noTurnStarted: true,
      noModelRolloutRequested: true,
    });
  } catch (error) {
    trace.push({
      _direction: "validation",
      _sanitized: true,
      result: "failed",
      error: sanitizeString(error instanceof Error ? error.message : String(error)),
    });
    throw error;
  } finally {
    await close();
    writeFileSync(traceFile, `${trace.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  }

  await processExit;
  console.log(`[trace] T-004 lifecycle validation passed: ${traceFile}`);
}

collectLifecycleTrace().catch((error) => {
  console.error(`[trace] T-004 lifecycle validation failed: ${error.message}`);
  process.exitCode = 1;
});
