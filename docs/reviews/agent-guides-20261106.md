# Installing a brain, step by step — 2026-11-06

Branch `codex/agent-guides`, stacked on #58. Item 8 of the 1.0 plan (the guidance part; see "Not in this change").

## Change

The brain picker's 安装说明 card used to show one bare command. For every catalogued agent, on macOS and Windows, it now gives numbered steps for someone who has never opened a terminal (`installSteps` in `packages/agents/installation.ts`):

- **Node.js first,** when the command needs it.
- **Opening the terminal:** ⌘ + 空格 → 终端 on a Mac, the Windows key → PowerShell on Windows.
- **Running the command:** copy it with **复制命令**, paste it, and press Enter.
- **Knowing it worked:** what finishing looks like, and to screenshot red text.
- **Back in Anna:** click 我已安装，重新检测.

Agents without a command get "download the installer from the official page, double-click it". Where the app can run the npm install itself, the card offers **让 Anna 帮你装** (the existing in-app install). For Claude Code and Codex it says a vendor API Key in 接通模型 works without an official login. The card scrolls into view when opened.

## Not in this change

Downloading Claude Code and Codex into Anna's own folder without Node.js (the design discussed earlier) is not done for 1.0: it needs real-machine Windows acceptance (Git Bash, Defender) that the schedule does not allow. The guide and the existing npm install cover both agents.

## Verification (macOS arm64)

- Tests first in `tests/installation-guide.test.ts`. They walk every catalogued agent on darwin and win32: at least two steps, ending with 重新检测; how to open the terminal when there is a command; no `curl`, `bash` or `sh` on Windows; an official link otherwise; and the one-click offer exactly when the install is automatable. A second test covers the Claude Code and Codex key note. Both failed before the implementation.
- `tests/onboarding.mjs` opens a guide and checks that the steps are listed and the card is on screen (`artifacts/install-guide.png`).
- `pnpm preflight`: 980 passed, 19 skipped (after the review fixes). `pnpm build` and `pnpm test:scripted` pass.

## Review

**Standards review: no blocker.** Should-fix, fixed:

- **One click installs what the card shows.** It is offered only when it runs the command the card shows (normalised for `npm.cmd`). For Claude Code the card shows the native installer, so there is no npm one-click.
- **A failed copy says so.** It shows 复制失败，请手动选中命令, and the copy state resets per agent.
- **The card is announced properly.** It is a labelled region instead of a live status, and its title takes focus.
- **The one-click test can fail.** It now asserts fixed expectations instead of recomputing the code's expression.
- **This record exists.**

**Spec review: three blockers, fixed.**

- **Shell-script-only agents on Windows** (Cursor, Antigravity, omp). The card used to "download the installer" from a page that is the script itself. It now says plainly that Windows is not supported yet and shows no link.
- **npm agents on Windows.** PowerShell's default policy blocks `npm.ps1`, so the command is shown as `npm.cmd`, with a reminder to open a new window after installing Node.js.
- **npm agents on a Mac.** A global install may fail with EACCES. The step now explains the `sudo` retry and the hidden password typing.

Should-fix, fixed:

- **Promises match what Anna can do.** "Anna 会用它保存的配置" is gone. Delegate-tier agents say they can be reached with @id. Detect-only agents say Anna can only detect them.
- **Claude Code on Windows** gets a Git for Windows step first.
- **One click comes first:** 让 Anna 帮你装 is listed before the steps.
- **Plainer steps.** They now say "光标停在新的一行" and mention Ctrl + V.

Not changed:

- The steps for Hermes and Goose are still generic.
- Whether the in-app npm install itself hits EACCES on a Mac with the official Node.js installer is unverified.
- These content fixes were checked by tests and the full suite, not by another review round.
