# 08: 含斜杠的 git 引用无法创建 —— 结论：agent 沙箱伪影，非项目缺陷

**Status:** closed（不是产品缺陷，也不是 git/仓库/磁盘缺陷）

> 修订说明：本工单初版把现象定性为「D 盘环境级缺陷」，并据此把 05 标为 blocked。
> 该定性**是错的**，已按下面的复验结果推翻。保留本工单是为了记录结论和坑位，
> 避免后续会话再踩一次。

## 现象

在 **agent 沙箱**内执行时，任何名字带 `/` 的 git 引用都建不出来：

| 命令 | 沙箱内 | 沙箱外 |
|---|---|---|
| `git branch task/x` | 退出码 0 但什么都不创建（静默失败） | 正常创建 |
| `git update-ref refs/heads/a/b HEAD` | 退出码 0 但什么都不创建 | 正常 |
| `git tag t1/x` | 退出码 0 但什么都不创建 | 正常 |
| `git worktree add .scratch/wt -b task/x` | `fatal: invalid reference: task/x` | 正常 |

不带斜杠的名字（`git branch probe-b`）在沙箱内也正常，所以很容易误判成
「git 写不了引用」或「D 盘坏了」。

## 复验过程（红 → 绿）

反馈循环脚本：`.scratch/m2-implementation/repro-08.mjs`
（同时建一个带斜杠和一个不带斜杠的分支做对照，退出码 0=GREEN / 1=RED）。

```
node .scratch/m2-implementation/repro-08.mjs <repoPath> [existing|fresh] [gitBin]
```

同一条命令、同一个仓库、同一个 git 二进制，只有沙箱状态不同：

- 沙箱内：`RED  D:/code/OtherCode/codex-mattpocock  slashed: NOT created / control: created`
- 沙箱外（命令被提权，输出带 `Sandbox bypassed` 横幅）：`GREEN ... slashed: created`

**决定性证据**：把同一命令连续跑三遍（A 工作区内 → B 工作区外 → 再 A），
只要整条命令被提权，三次全 GREEN；没被提权的运行全 RED。
git 二进制不是变量：PortableGit `2.55.0.windows.3` 与系统 Git `2.51.0.windows.2`
在同一沙箱状态下结论一致。

## 根因

**WorkBuddy agent 沙箱的文件系统层**，不是 git、不是仓库、不是 D 盘。

git 创建 `refs/heads/<ns>/<name>` 需要「先建子目录、再在新目录里建文件」，
沙箱层拦掉了这一步（bash 的 `mkdir -p` 不受影响，所以手工建目录看不出问题）。
C 盘临时目录不拦，D 盘工作区拦 —— 这个盘符相关性一度把我误导到「D 盘卷属性」
的方向上，实际是沙箱的作用范围差异。

## 影响面（已解除）

- **M2-05 不再被阻塞。** 初版把 05 的 blockers 从 `02` 改成 `02, 08` 是误判，已改回。
- **M1 E2E 不再被阻塞。** 沙箱外运行 `.scratch/m1-e2e/verify.mjs` 结果为
  **18 passed / 0 failed**，`release-evidence/m1-slice-e2e.json` 已写入 `pass: true`。
  9-05 记录里「M1 后续测试在 worktree:create 被 git 2.55 ref 校验阻塞，与本次重构无回归关系」
  这句话的前提错了 —— 不是 ref 校验，是沙箱。

## 坑位（给后续会话）

在 agent 里跑任何**会创建带 `/` 的 git 引用**的命令（`git branch xx/yy`、
`git worktree add -b`、M1 E2E、M2-05 的 Child Task 建 worktree）之前，
先确认这条命令能跑在沙箱外，否则会看到「静默失败」或 `fatal: invalid reference`
并误以为仓库坏了。判定方法：看输出里有没有 `Sandbox bypassed` 横幅，
或直接用 `repro-08.mjs` 探一下。
