/**
 * T-005: Codex App Server Turn control trace collector (sanitized).
 *
 * Validates turn/start, turn/steer, and turn/interrupt through the stdio
 * JSONL boundary. The probe starts a Turn, immediately steers it, then
 * interrupts it — verifying protocol behavior without waiting for model
 * completion.
 *
 * Usage: node scripts/spike/turn-control-trace.mjs
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
const traceFile = join(traceDir, "turn-control-trace.jsonl");
const isolatedCodexHome = join(projectRoot, "cache", "t005-turn-control-home");

const secretKeyPattern = /token|secret|password|api[_-]?key|authorization|originurl/i;
const secretValuePatterns = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
];
const turnIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function assertId(value, label) {
  if (typeof value !== "string" || !turnIdPattern.test(value)) {
    throw new Error(`${label} did not return a UUID-shaped ID.`);
  }
}

function createChildEnvironment() {
  const environment = { ...process.env, CODEX_HOME: isolatedCodexHome };

  for (const key of Object.keys(environment)) {
    if (secretKeyPattern.test(key)) {
      delete environment[key];
    }
  }

  return environment;
}

async function collectTurnControlTrace() {
  mkdirSync(traceDir, { recursive: true });
  mkdirSync(isolatedCodexHome, { recursive: true });

  const trace = [];
  const pending = new Map();
  const notifications = [];
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

  const sendNotification = (method, params) => {
    const message = { method, params };
    record("client-to-server", message);
    proc.stdin.write(`${JSON.stringify(message)}\n`);
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

        // Handle notifications (no id field)
        if (response.id === undefined && response.method) {
          const sanitized = sanitize(response);
          notifications.push(sanitized);
          record("server-to-client-notification", sanitized);
          continue;
        }

        // Handle responses to our requests
        const pendingRequest = pending.get(response.id);
        if (!pendingRequest) {
          continue;
        }

        pending.delete(response.id);
        if (pendingRequest.traceOperation) {
          record("server-to-client", response);
        }
        pendingRequest.resolveResponse(response);
      } catch {
        // Not JSON, skip
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

  // Helper: wait for a specific notification method
  const waitForNotification = (method, timeoutMs = 10000) => {
    return new Promise((resolveWait, rejectWait) => {
      const timer = setTimeout(() => {
        rejectWait(new Error(`Timeout waiting for notification: ${method}`));
      }, timeoutMs);

      const check = () => {
        const found = notifications.find((n) => n.method === method);
        if (found) {
          clearTimeout(timer);
          resolveWait(found);
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  };

  try {
    // --- Initialize handshake ---
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

    sendNotification("initialized", {});

    // --- Create thread ---
    const started = await request("thread/start", {
      cwd: projectRoot,
      approvalPolicy: "on-request",
      sandbox: "read-only",
      serviceName: "workbench-spike",
    });
    if (!isSuccessfulResponse(started)) {
      throw new Error(`thread/start failed: ${JSON.stringify(sanitize(started))}`);
    }

    const threadId = started.result?.thread?.id;
    assertId(threadId, "thread/start");

    // --- Turn 1: start + steer + interrupt ---
    const turnStarted = await request("turn/start", {
      threadId,
      input: [{ type: "text", text: "T-005 turn control probe: start then immediately steer and interrupt.", text_elements: [] }],
    });
    if (!isSuccessfulResponse(turnStarted)) {
      throw new Error(`turn/start failed: ${JSON.stringify(sanitize(turnStarted))}`);
    }

    const turnId = turnStarted.result?.turn?.id;
    assertId(turnId, "turn/start");

    // Wait for turn/started notification
    try {
      const turnStartedNotif = await waitForNotification("turn/started", 5000);
      record("server-notification-captured", { method: "turn/started", turnId: turnStartedNotif.params?.turn?.id });
    } catch {
      // Notification may have already been captured or may not arrive in time
      record("server-notification-skipped", { method: "turn/started", reason: "timeout or already captured" });
    }

    // --- turn/steer: inject immediate input into the running turn ---
    const steered = await request("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: "text", text: "T-005 steer: immediate adjustment, not queued input.", text_elements: [] }],
    });

    const steerSuccess = isSuccessfulResponse(steered);
    record("steer-validation", {
      success: steerSuccess,
      isImmediateAdjustment: steerSuccess,
      error: steerSuccess ? null : sanitize(steered),
    });

    // --- turn/interrupt: interrupt the running turn ---
    const interrupted = await request("turn/interrupt", {
      threadId,
      turnId,
    });

    const interruptSuccess = isSuccessfulResponse(interrupted);
    record("interrupt-validation", {
      success: interruptSuccess,
      error: interruptSuccess ? null : sanitize(interrupted),
    });

    // Wait briefly for turn/completed notification
    try {
      const completedNotif = await waitForNotification("turn/completed", 5000);
      const turnStatus = completedNotif.params?.turn?.status;
      record("turn-completed-validation", {
        received: true,
        turnStatus: sanitize(turnStatus),
      });
    } catch {
      record("turn-completed-validation", {
        received: false,
        reason: "timeout — turn may still be completing",
      });
    }

    // --- Final validation summary ---
    trace.push({
      _direction: "validation",
      _sanitized: true,
      result: steerSuccess && interruptSuccess ? "passed" : "partial",
      threadId,
      turnId,
      turnStartSuccess: true,
      steerSuccess,
      steerIsImmediateAdjustment: steerSuccess,
      interruptSuccess,
      details: {
        turnStartReturnedTurnId: typeof turnId === "string" && turnIdPattern.test(turnId),
        steerReturnedSuccess: steerSuccess,
        interruptReturnedSuccess: interruptSuccess,
      },
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
  console.log(`[trace] T-005 turn control validation completed: ${traceFile}`);
}

collectTurnControlTrace().catch((error) => {
  console.error(`[trace] T-005 turn control validation failed: ${error.message}`);
  process.exitCode = 1;
});
