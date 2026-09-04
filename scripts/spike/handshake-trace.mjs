/**
 * T-003: Codex App Server initialize handshake trace collector (sanitized).
 *
 * Starts codex app-server via stdio, sends initialize + initialized,
 * records ONLY the handshake JSONL trace (initialize request/response),
 * fully sanitized. Does NOT call thread/list to avoid leaking user data.
 *
 * Usage: node scripts/spike/handshake-trace.mjs
 */

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..", "..");

const codexPath = join(projectRoot, "runtime", "codex.exe");
const traceDir = join(projectRoot, "release-evidence", "protocol-trace");
const traceFile = join(traceDir, "initialize-trace.jsonl");

mkdirSync(traceDir, { recursive: true });

const traceStream = createWriteStream(traceFile, { encoding: "utf-8" });

// Patterns to redact from trace
const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,             // OpenAI API keys
  /Bearer\s+[a-zA-Z0-9._-]+/gi,       // Bearer tokens
  /"(?:token|secret|key|password|apiKey)"\s*:\s*"[^"]*"/gi, // credential fields
];

// Patterns to redact user-identifying data
const PII_PATTERNS = [
  /C:\\\\Users\\\\[^\\"]+/g,           // Windows user paths
  /D:\\\\code\\\\[^\\"]+/g,            // D drive project paths
  /"installationId":"[^"]*"/g,         // installation ID
  /"serverName":"[^"]*"/g,             // server name
  /"codexHome":"[^"]*"/g,              // codex home path
];

function sanitize(line) {
  let s = line;
  for (const p of [...SECRET_PATTERNS, ...PII_PATTERNS]) {
    s = s.replace(p, '"[REDACTED]"');
  }
  // Fix double-redacted quotes
  s = s.replace(/"\[REDACTED\]"\s*:\s*"\[REDACTED\]"/g, '"[REDACTED]":"[REDACTED]"');
  return s;
}

function send(proc, message) {
  const json = JSON.stringify(message);
  proc.stdin.write(`${json}\n`);
  traceStream.write(`{"_direction":"client-to-server","_sanitized":true,${json.slice(1)}\n`);
  console.log(`[client] -> ${json}`);
}

const proc = spawn(codexPath, ["app-server"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let initialized = false;
const timeout = setTimeout(() => {
  if (!initialized) {
    console.error("[trace] Timeout waiting for initialize response");
    proc.kill("SIGTERM");
    process.exit(1);
  }
}, 15000);

proc.stdout.on("data", (chunk) => {
  const lines = chunk.toString().split("\n").filter(Boolean);
  for (const line of lines) {
    // Only record the initialize response (id:0), skip everything else
    try {
      const msg = JSON.parse(line);
      if (msg.id === 0 && msg.result) {
        const sanitized = sanitize(line);
        traceStream.write(`{"_direction":"server-to-client","_sanitized":true,${sanitized.slice(1)}\n`);
        console.log(`[server] <- initialize response (sanitized)`);
        initialized = true;
        clearTimeout(timeout);
        // Send initialized notification
        send(proc, { method: "initialized", params: {} });
        // Handshake complete — close after a short delay
        setTimeout(() => {
          traceStream.end();
          proc.kill("SIGTERM");
          process.exit(0);
        }, 500);
      }
    } catch {
      // Not JSON or not the initialize response, skip
    }
  }
});

proc.stderr.on("data", (chunk) => {
  // Don't record stderr in trace
  console.error(`[stderr] ${chunk.toString()}`);
});

proc.on("exit", (code) => {
  clearTimeout(timeout);
  traceStream.end();
  console.log(`[trace] Process exited with code ${code}`);
  process.exit(0);
});

// Send initialize request
send(proc, {
  method: "initialize",
  id: 0,
  params: {
    clientInfo: {
      name: "workbench-spike",
      title: "Workbench Spike",
      version: "0.0.1",
    },
  },
});
