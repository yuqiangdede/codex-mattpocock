/**
 * M1 Single Task Vertical Slice — end-to-end verification script.
 *
 * Drives the same core functions used by the desktop IPC layer to validate
 * the full M1 slice path:
 *
 *   Project Scan → Task Creation → Integration Worktree → Turn Execution
 *   → Approval → Diff → Verification → Renderer Reload Recovery
 *
 * This is a headless stand-in for the interactive Electron UI: it replicates
 * the deterministic turn flow that `apps/desktop/main/src/index.ts` performs
 * (startTurn emits TurnStarted + ApprovalRequested; decideApproval on approve
 * writes hello() to the worktree and emits TurnCompleted).
 *
 * Gate evidence (from .scratch/m0-m1-implementation-readiness-spike/m1-slice-boundary.md):
 *   - Event trace entries for each step
 *   - `git worktree list` shows task/<taskId> branch
 *   - Diff shows hello() added to index.ts
 *   - `npm test` exits 0
 *   - Task ID before reload == Task ID after reload; event count matches
 */

import { WorkbenchDatabase } from "../../packages/storage/dist/index.js";
import {
  scanProject,
  createWorktree,
  getDiff,
  runVerification,
} from "../../packages/git-worktree/dist/index.js";
import {
  generateId,
} from "../../packages/shared/dist/index.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

// --- Fixture / scratch locations (relative to repo root) ---
const repoRoot = process.cwd();
const fixturePath = join(repoRoot, ".scratch", "m1-fixture");
const scratchRoot = join(repoRoot, ".scratch", "m1-e2e");
const dbPath = join(scratchRoot, "workbench.db");
const worktreeBase = join(scratchRoot, "worktrees");

// Evidence output, consumed by scripts/verify.ps1 (M1 gate)
const evidencePath = join(repoRoot, "release-evidence", "m1-slice-e2e.json");

// Clean runtime data only (NOT the script file, which lives here too)
rmSync(dbPath, { force: true });
rmSync(worktreeBase, { recursive: true, force: true });
mkdirSync(worktreeBase, { recursive: true });

let passed = 0;
let failed = 0;
function check(label, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✔ ${label}${detail ? " — " + detail : ""}`);
  } else {
    failed++;
    console.error(`  ✘ ${label}${detail ? " — " + detail : ""}`);
  }
}

function emit(db, taskId, turnId, type, payload) {
  db.appendEvent({
    id: generateId("evt"),
    type,
    taskId,
    turnId,
    payload,
    timestamp: new Date().toISOString(),
  });
}

console.log("=== M1 Single Task Vertical Slice — E2E ===");
console.log(`Fixture: ${fixturePath}\n`);

// ================================================================
// 1) Project Scan
// ================================================================
console.log("[1/8] Project Scan");
const scan = scanProject(fixturePath);
check("toolchain detected", scan.hasGit && scan.hasPackageJson && scan.hasTsConfig,
  `toolchain=[${scan.toolchain.join(", ")}]`);
check("project name resolved", scan.name === "m1-fixture", scan.name);

// ================================================================
// 2) Task Creation
// ================================================================
console.log("\n[2/8] Task Creation");
const db = new WorkbenchDatabase(dbPath);
db.insertProject({
  id: generateId("proj"),
  name: scan.name,
  path: scan.path,
  toolchain: scan.toolchain,
  createdAt: new Date().toISOString(),
});
emit(db, null, null, "ProjectScanned", { projectPath: scan.path });
const projects = db.listProjects();
check("project persisted", projects.length === 1, projects[0].name);

const task = {
  id: generateId("task"),
  projectId: projects[0].id,
  prompt: "Add a hello() function that returns 'hello world'",
  lifecycle: "OPEN",
  executionState: "IDLE",
  attentionState: "NONE",
  worktreePath: null,
  worktreeBranch: null,
  createdAt: new Date().toISOString(),
};
db.insertTask(task);
emit(db, task.id, null, "TaskCreated", { taskId: task.id, prompt: task.prompt });
const savedTask = db.getTask(task.id);
check("task persisted with prompt", !!savedTask && savedTask.prompt.includes("hello"), task.id);

// ================================================================
// 3) Integration Worktree
// ================================================================
console.log("\n[3/8] Integration Worktree");
const wt = createWorktree(scan.path, task.id, worktreeBase);
db.updateTaskWorktree(task.id, wt.path, wt.branch);
emit(db, task.id, null, "WorktreeCreated", { branch: wt.branch, worktreePath: wt.path });

const worktreeList = execSync("git worktree list", { cwd: scan.path, encoding: "utf8" });
check(
  "worktree created",
  worktreeList.includes(wt.path.replace(/\\/g, "/")),
  wt.branch,
);
check("branch named task/<id>", wt.branch === `task/${task.id}`, wt.branch);

// Confirm M1 TDD red-start: tests fail on the pristine worktree (hello missing)
const redCheck = runVerification(wt.path, "npm test");
check("red state before turn (test fails)", !redCheck.passed, `exit=${redCheck.exitCode}`);

// ================================================================
// 4) Turn Execution + 5) Approval (simulated, mirrors main process)
// ================================================================
console.log("\n[4/8] Turn Execution & [5/8] Approval");
const turnId = generateId("turn");
db.updateTaskStates(task.id, "RUNNING", "NONE");
emit(db, task.id, turnId, "TurnStarted", { turnId, prompt: task.prompt });

const approvalId = generateId("appr");
emit(db, task.id, turnId, "ApprovalRequested", {
  approvalId,
  type: "file",
  target: "index.ts",
  summary: "Write hello() function to index.ts",
});

// Approve -> write hello() to worktree (same code path as main/src/index.ts)
const indexPath = join(wt.path, "index.ts");
writeFileSync(
  indexPath,
  `export function hello(): string {\n  return "hello world";\n}\n`,
  "utf8",
);
emit(db, task.id, turnId, "ApprovalDecided", { approvalId, decision: "approved", type: "file", target: "index.ts" });
db.updateTaskStates(task.id, "IDLE", "NONE");
emit(db, task.id, turnId, "TurnCompleted", { status: "completed", diffSummary: "1 file modified" });

const afterTurn = db.getTask(task.id);
check("task state IDLE after turn", afterTurn?.executionState === "IDLE", afterTurn?.executionState);

// ================================================================
// 6) Diff
// ================================================================
console.log("\n[6/8] Diff");
const diff = getDiff(wt.path);
diff.taskId = task.id;
const helloFile = diff.files.find((f) => f.path === "index.ts");
check("diff shows index.ts changed", !!helloFile, helloFile ? `${helloFile.status} +${helloFile.additions}` : "none");
check("diff contains hello()", helloFile?.patch.includes("hello"), "patch has hello()");
check("diff summary", diff.files.length >= 1, diff.summary);

// ================================================================
// 7) Verification
// ================================================================
console.log("\n[7/8] Verification");
const ver = runVerification(wt.path, "npm test");
ver.taskId = task.id;
emit(db, task.id, null, "VerificationCompleted", { exitCode: ver.exitCode, passed: ver.passed });
check("npm test passes (exit 0)", ver.passed && ver.exitCode === 0, `exit=${ver.exitCode}`);
check("test output captured", ver.output.length > 0, `${ver.output.length} chars`);

// ================================================================
// 8) Renderer Reload Recovery
// ================================================================
console.log("\n[8/8] Renderer Reload Recovery");
const taskIdBefore = task.id;
const eventsBefore = db.getEvents(task.id).length;
db.close(); // simulate app teardown

// Reopen a fresh connection (simulates renderer reload re-reading from SQLite)
const db2 = new WorkbenchDatabase(dbPath);
const tasksAfter = db2.listTasks();
const eventsAfter = db2.getEvents(task.id).length;
const taskAfter = tasksAfter.find((t) => t.id === taskIdBefore);

check("task ID preserved across reload", taskAfter?.id === taskIdBefore, taskAfter?.id ?? "missing");
check("task state recovered (projection/status)", taskAfter?.executionState === "IDLE", taskAfter?.executionState);
const projection = db2.getProjection(task.id);
check("projection recovered", !!projection && projection.status === "VerificationCompleted", projection?.status ?? "none");
check("event count preserved", eventsBefore === eventsAfter && eventsAfter >= 7, `${eventsAfter} events`);

const ordered = db2.getEvents(task.id).map((e) => e.type);
console.log(`\nTimeline (${ordered.length} events):`);
ordered.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));

db2.close();

// Clean up the worktree we created for this task
try {
  execSync(`git worktree remove --force "${wt.path}"`, { cwd: scan.path, encoding: "utf8" });
  check("worktree cleaned up", true);
} catch {
  check("worktree cleaned up", false, "remove failed — leaving in place");
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
mkdirSync(join(repoRoot, "release-evidence"), { recursive: true });
writeFileSync(
  evidencePath,
  JSON.stringify({ overall: { pass: failed === 0, passed, failed } }, null, 2),
  "utf8",
);
process.exit(failed === 0 ? 0 : 1);