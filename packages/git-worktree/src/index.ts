/**
 * @workbench/git-worktree
 *
 * Git worktree management for task isolation.
 * Each task gets its own worktree on a branch: task/<taskId>
 */

import { execSync, type ExecSyncOptions } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { DiffResult, DiffFile, VerificationResult } from "@workbench/shared";

function runGit(args: string[], cwd: string): string {
  const result = execSync("git " + args.join(" "), {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 30000,
  } as ExecSyncOptions);
  return String(result).trim();
}

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export function createWorktree(
  projectPath: string,
  taskId: string,
  worktreeBaseDir: string,
): WorktreeInfo {
  const branch = `task/${taskId}`;
  const worktreePath = join(worktreeBaseDir, taskId);

  // Ensure base dir exists
  if (!existsSync(worktreeBaseDir)) {
    mkdirSync(worktreeBaseDir, { recursive: true });
  }

  // Create a new branch and worktree
  runGit(["worktree", "add", "-b", branch, worktreePath], projectPath);

  return { path: worktreePath, branch };
}

export function removeWorktree(projectPath: string, worktreePath: string): void {
  runGit(["worktree", "remove", "--force", worktreePath], projectPath);
}

export function getDiff(worktreePath: string): DiffResult {
  let rawDiff: string;
  try {
    // Diff the working tree (committed + uncommitted) against the parent
    // branch (main/master). This captures every change the turn produced so
    // far, not just the committed delta.
    const baseBranch = detectMainBranch(worktreePath);
    rawDiff = runGit(["diff", baseBranch], worktreePath);
  } catch {
    // Fallback: diff against HEAD (uncommitted changes)
    rawDiff = runGit(["diff", "HEAD"], worktreePath);
  }

  const files = parseDiffOutput(rawDiff);
  const summary = `${files.length} file(s) changed`;

  return {
    taskId: "", // Filled by caller
    files,
    summary,
  };
}

function detectMainBranch(cwd: string): string {
  try {
    runGit(["rev-parse", "--verify", "main"], cwd);
    return "main";
  } catch {
    try {
      runGit(["rev-parse", "--verify", "master"], cwd);
      return "master";
    } catch {
      return "HEAD~1";
    }
  }
}

function parseDiffOutput(diff: string): DiffFile[] {
  if (!diff.trim()) return [];

  const files: DiffFile[] = [];
  const chunks = diff.split(/^diff --git /m).filter(Boolean);

  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const header = lines[0] || "";

    // Extract file path from "a/path b/path"
    const match = header.match(/a\/(.+) b\/(.+)/);
    if (!match) continue;

    const filePath = match[2];
    let status: DiffFile["status"] = "modified";
    let additions = 0;
    let deletions = 0;

    for (const line of lines) {
      if (line.startsWith("new file mode")) status = "added";
      else if (line.startsWith("deleted file mode")) status = "deleted";
      else if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }

    files.push({
      path: filePath,
      status,
      additions,
      deletions,
      patch: chunk.slice(0, 5000), // Limit patch size
    });
  }

  return files;
}

export function runVerification(
  worktreePath: string,
  command: string,
): VerificationResult {
  try {
    const output = execSync(command, {
      cwd: worktreePath,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60000,
    } as ExecSyncOptions);

    return {
      taskId: "", // Filled by caller
      exitCode: 0,
      output: String(output).slice(0, 10000),
      passed: true,
    };
  } catch (err: unknown) {
    const error = err as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    return {
      taskId: "",
      exitCode: error.status ?? 1,
      output: String(error.stdout ?? error.stderr ?? error.message ?? "Unknown error").slice(0, 10000),
      passed: false,
    };
  }
}

export function scanProject(projectPath: string) {
  const toolchain: string[] = [];

  // Check for git
  let hasGit = false;
  try {
    runGit(["status"], projectPath);
    hasGit = true;
    toolchain.push("git");
  } catch {
    // Not a git repo
  }

  // Check for package.json
  const hasPackageJson = existsSync(join(projectPath, "package.json"));
  if (hasPackageJson) toolchain.push("npm");

  // Check for tsconfig.json
  const hasTsConfig = existsSync(join(projectPath, "tsconfig.json"));
  if (hasTsConfig) toolchain.push("typescript");

  // Get project name from directory
  const name = projectPath.split(/[\\/]/).pop() || "unknown";

  return {
    path: projectPath,
    name,
    toolchain,
    hasGit,
    hasPackageJson,
    hasTsConfig,
  };
}
