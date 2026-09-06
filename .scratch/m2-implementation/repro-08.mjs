#!/usr/bin/env node
/**
 * Issue 08 — 含斜杠 git 引用创建失败：红/绿反馈循环
 *
 * 结论（2026-09-06）：这是 WorkBuddy agent 沙箱的文件系统层伪影，不是项目/磁盘缺陷。
 * 同一条命令、同一个仓库、同一个 git 二进制，在沙箱内 RED、沙箱外 GREEN。
 * 所以这个脚本现在的主要用途是**判定当前命令是否跑在沙箱内**：
 *   - RED 且 control 为 created  → 你正在沙箱里，别在这里跑建 worktree / 建 task/<id> 分支的操作
 *   - GREEN                      → 可以放心跑
 * 判定沙箱状态另有一个更快的信号：命令输出里是否出现 `Sandbox bypassed` 横幅。
 *
 * 用法：
 *   node repro-08.mjs <path> [existing|fresh]
 *
 *   existing —— 在给定仓库里试建 `task/<id>` 分支（判定该仓库位置是否患病）
 *   fresh    —— 在给定目录下 git init 一个空仓库再试（判定该卷/路径是否患病）
 *
 * 退出码 0 = GREEN（斜杠引用建得出来），1 = RED（建不出来，bug 复现）
 * 同时建一个不带斜杠的同名分支作为对照：对照也必须 GREEN，否则说明这个
 * 位置的 git 根本写不了引用，本循环就失效了（不是 08 这个 bug）。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [, , target = process.cwd(), mode = "existing"] = process.argv;
// 4th arg：显式指定 git 可执行文件（用于区分 PortableGit / 系统 Git）
const gitBin = process.argv[4] ?? "git";

function git(args, cwd) {
  try {
    return { ok: true, out: execFileSync(gitBin, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

let repo = target;
let tempDir = null;
if (mode === "fresh") {
  tempDir = mkdtempSync(path.join(target, "refprobe-"));
  repo = tempDir;
  git(["init", "-q"], repo);
  git(["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], repo);
}

const stamp = Date.now();
const slashed = `task/probe-${stamp}`;
const flat = `probe-${stamp}`;

const slashRun = git(["branch", slashed], repo);
const flatRun = git(["branch", flat], repo);

const refs = git(["for-each-ref", "--format=%(refname)", "refs/heads/"], repo)
  .out.split("\n")
  .filter(Boolean);

const slashOk = refs.includes(`refs/heads/${slashed}`);
const flatOk = refs.includes(`refs/heads/${flat}`);

const verdict = slashOk ? "GREEN" : "RED";
console.log(`${verdict}  ${repo}  [git: ${gitBin} ${git(["--version"], repo).out.trim()}]`);
console.log(`  slashed  refs/heads/${slashed}: ${slashOk ? "created" : "NOT created"}${
  slashRun.out.trim() ? `  [git: ${slashRun.out.trim().replace(/\n/g, " | ")}]` : ""
}`);
console.log(`  control  refs/heads/${flat}: ${flatOk ? "created" : "NOT created"}${
  flatRun.out.trim() ? `  [git: ${flatRun.out.trim().replace(/\n/g, " | ")}]` : ""
}`);
if (!flatOk) {
  console.log("  !! 对照组也失败 —— 该位置 git 根本写不了引用，本循环对 08 无效");
}

// cleanup：我们建的分支（建得出来才需要删）+ fresh 模式的临时仓库
for (const b of [slashed, flat]) {
  if (refs.includes(`refs/heads/${b}`)) git(["branch", "-D", b], repo);
}
if (tempDir) {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    console.log(`  (临时目录未清理: ${tempDir})`);
  }
}

process.exit(slashOk ? 0 : 1);
