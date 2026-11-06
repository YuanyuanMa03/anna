# Her voice as company and report — 2026-11-06

Branch `codex/voice-companion`, stacked on #60.

## Change

- **Spoken report, not the whole reply** (`packages/voice/report.ts`):
  - A chat reply is spoken as a sentence or two, up to about 90 characters.
  - After work she says her own first sentence plus the real numbers from the task result ("改了 N 个文件", "测试都过了" / "有测试没过"), then "细节在屏幕上".
  - Code, inline code, paths, file names and list lines are never spoken.
  - A failed or stopped task says so in one line.
- **An approval in one spoken line,** for example "我想修改文件：tasks.txt。可以的话点一下‘允许’"; a risky one asks the person to look at the screen. The decision is still a click.
- **One microphone in the chat box.** The box now holds the text, a round microphone button (accessible name 和她说话 / 结束对话), the talk status, the modes and send. 停止说话 appears only while she is speaking outside a talk.
- **Voice controls moved to model settings.** 语音设置 (recognition and synthesis) and 开启/关闭模型语音 now live in Anna 档案 → 3 接通模型 → 她的声音. Opening 语音设置 from there closes the 档案 sheet, so only the voice dialog is on screen. Both places share `apps/desktop/src/voice-state.ts`, and it still starts muted.

## Verification (macOS arm64)

- `tests/spoken-report.test.ts` covers a chat reply, finished work with numbers (no code or paths spoken), failing tests, failed and stopped tasks, read-only work, and approvals.
- The scripted desktop flows reach the voice controls through the settings, and check that the chat box no longer carries them.
- `pnpm preflight`: 990 passed, 19 skipped. `pnpm build` and `pnpm test:scripted` pass (`artifacts/voice-talk.png` shows the new chat box).

## Not verified

- Real voices and real tasks: the report wording was checked only with fixed inputs.

## Review

Standards and Spec reviews in parallel: no blockers. Fixed:

- Failed and stopped tasks are now spoken (the app only spoke completed ones).
- The path pattern no longer eats "1/2", dates, "TCP/IP" or "和/或". Links are dropped whole.
- Her words and the numbers are separated by "。".
- "细节在屏幕上" is said only when more is on screen than was spoken.
- A short opener carries on into the next sentence; English is cut at a word.
- A code-only reply says "好了，细节在屏幕上".
- Approvals use the permission system's own reason plus a file name or the command's first words.
- A spoken approval stops when it is answered.
- 停止说话 shows during synthesis too.
- A voice setting changed during a talk is kept when the talk ends.

Not re-reviewed: the owner asked to ship 1.0 now.
