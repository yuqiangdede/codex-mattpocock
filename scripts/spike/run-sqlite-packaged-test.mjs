/**
 * T-011: Validate node:sqlite in Packaged Electron Utility Process.
 *
 * This script launches Electron with a main process that forks a Utility Process
 * running sqlite-test-child.js. It captures stdout from the child process and
 * writes the results to release-evidence/sqlite-packaged-test.json.
 *
 * Usage: node scripts/spike/run-sqlite-packaged-test.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..", "..");
const reportDir = join(projectRoot, "release-evidence");
const reportFile = join(reportDir, "sqlite-packaged-test.json");

const electronPath = join(projectRoot, "node_modules", "electron", "dist", "electron.exe");
const mainScript = join(__dirname, "electron-sqlite-main.js");

mkdirSync(reportDir, { recursive: true });

const testStartTime = new Date().toISOString();

console.log("[sqlite-test] Starting Electron SQLite packaged test...");
console.log(`[sqlite-test] Electron: ${electronPath}`);
console.log(`[sqlite-test] Main script: ${mainScript}`);

const child = spawn(electronPath, ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", mainScript], {
  cwd: projectRoot,
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";

child.stdout.on("data", (data) => {
  const text = data.toString();
  stdout += text;
  // Print each line as it comes
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

  // Parse stdout lines as JSON
  const lines = stdout.trim().split("\n").filter((l) => l.trim());
  const testResults = [];
  let summary = null;
  let fatalError = null;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.done) {
        summary = obj;
      } else if (obj.test) {
        testResults.push(obj);
      } else if (obj.error) {
        fatalError = obj.error;
      }
    } catch {
      // Not JSON, skip
    }
  }

  // Also check stderr for fatal errors
  if (!summary && stderr) {
    const errLines = stderr.trim().split("\n").filter((l) => l.trim());
    for (const line of errLines) {
      try {
        const obj = JSON.parse(line);
        if (obj.done) {
          summary = obj;
          if (obj.fatalError) fatalError = obj.fatalError;
        }
      } catch {
        // Not JSON
      }
    }
  }

  const allPassed = summary ? summary.allPassed : false;
  const electronVersion = "35.7.5";
  const nodeVersion = process.version;

  const report = {
    testStartedAt: testStartTime,
    testCompletedAt: testEndTime,
    environment: {
      electron: electronVersion,
      node: nodeVersion,
      packaged: true, // Running in Electron binary, not unpacked dev mode
      utilityProcess: true,
    },
    results: testResults,
    summary: summary || {
      done: true,
      allPassed: false,
      fatalError: fatalError || `Electron exited with code ${code}`,
      testCount: testResults.length,
      passedCount: testResults.filter((r) => r.pass).length,
      failedCount: testResults.filter((r) => !r.pass).length,
    },
    overall: {
      pass: allPassed,
      stopConditionTriggered: !allPassed,
      stopConditionReason: !allPassed
        ? "Packaged SQLite not available (US-32)"
        : null,
    },
    rawStdout: stdout.slice(0, 5000),
    rawStderr: stderr.slice(0, 2000),
    exitCode: code,
  };

  writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`\n[sqlite-test] Report saved: ${reportFile}`);
  console.log(`[sqlite-test] All passed: ${allPassed}`);
  console.log(`[sqlite-test] Exit code: ${code}`);

  if (!allPassed) {
    console.log(
      "[sqlite-test] STOP CONDITION: Packaged SQLite not available (US-32)",
    );
    if (fatalError) {
      console.log(`[sqlite-test] Fatal error: ${fatalError}`);
    }
  }

  process.exit(allPassed ? 0 : 1);
});
