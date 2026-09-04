/**
 * T-012: Validate Provider Secret isolation with sentinel token.
 *
 * Launches Electron with a main process that forks a Utility Process
 * running secret-isolation-child.js. Captures results and writes report.
 *
 * Usage: node scripts/spike/run-secret-isolation-test.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..", "..");
const reportDir = join(projectRoot, "release-evidence");
const reportFile = join(reportDir, "secret-isolation-report.json");

const electronPath = join(projectRoot, "node_modules", "electron", "dist", "electron.exe");
const mainScript = join(__dirname, "electron-secret-main.js");

mkdirSync(reportDir, { recursive: true });

const testStartTime = new Date().toISOString();

console.log("[secret-test] Starting secret isolation test...");
console.log(`[secret-test] Electron: ${electronPath}`);

const child = spawn(
  electronPath,
  ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", mainScript],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
    stdio: ["pipe", "pipe", "pipe"],
  },
);

let stdout = "";
let stderr = "";

child.stdout.on("data", (data) => {
  const text = data.toString();
  stdout += text;
  for (const line of text.trim().split("\n")) {
    if (line.trim()) console.log(`[child] ${line}`);
  }
});

child.stderr.on("data", (data) => {
  const text = data.toString();
  stderr += text;
  for (const line of text.trim().split("\n")) {
    if (line.trim()) console.log(`[child:err] ${line}`);
  }
});

child.on("close", (code) => {
  const testEndTime = new Date().toISOString();

  const lines = stdout.trim().split("\n").filter((l) => l.trim());
  const testResults = [];
  let summary = null;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.done) {
        summary = obj;
      } else if (obj.check) {
        testResults.push(obj);
      }
    } catch {
      // Not JSON
    }
  }

  const allPassed = summary ? summary.allPassed : false;

  const report = {
    testStartedAt: testStartTime,
    testCompletedAt: testEndTime,
    environment: {
      electron: "35.7.5",
      node: "v22.22.2",
      utilityProcess: true,
      allowlistEnv: true,
    },
    sentinelToken: {
      prefix: "SENTINEL_SECRET_TOKEN_T012_",
      fullLength: 42,
      storedIn: "private config dir (.env simulation)",
    },
    checks: testResults,
    summary: summary || {
      done: true,
      allPassed: false,
      fatalError: `Electron exited with code ${code}`,
      testCount: testResults.length,
      passedCount: testResults.filter((r) => r.pass).length,
      failedCount: testResults.filter((r) => !r.pass).length,
    },
    overall: {
      pass: allPassed,
      stopConditionTriggered: !allPassed,
      stopConditionReason: !allPassed
        ? "Credential leak detected (US-31)"
        : null,
    },
    rawStdout: stdout.slice(0, 5000),
    rawStderr: stderr.slice(0, 2000),
    exitCode: code,
  };

  writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`\n[secret-test] Report saved: ${reportFile}`);
  console.log(`[secret-test] All passed: ${allPassed}`);
  console.log(`[secret-test] Exit code: ${code}`);

  if (!allPassed) {
    console.log("[secret-test] STOP CONDITION: Credential leak detected (US-31)");
  }

  process.exit(allPassed ? 0 : 1);
});
