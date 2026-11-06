# Their time together (memory view) — 2026-11-06

Branch `codex/memory-view`, stacked on #56. Item 6 of the 1.0 plan.

## Change

The 共同记忆 tab opens with **我们**:

- Four counts: days since the first record, tasks finished and kept, things she remembers, agreements.
- **她眼中的你:** the nickname, what you mainly do together, and her memories as chips grouped by kind.
- **我们的故事:** a timeline, newest first, of finished tasks, memories and milestones (the first task finished together, then every tenth). At most 24 moments.

Everything comes from the work records and her diary (`packages/shared/relationship.ts`, exposed as `snapshot.relationship` by the host from every workspace's records). Nothing is estimated or scored. The existing list with edit and delete stays below it.

Also folded in: three nits from the re-review of #56.

- A stray `ANNA_TEST_BACKGROUND` no longer leaks into shown runs.
- The tray's 显示 restores the regular activation policy before showing a background window.
- The idle-frame check waits for the card click's reaction to finish.

## Verification (macOS arm64)

- `tests/relationship.test.ts` covers the empty state, day counting from the earliest record, only finished and kept tasks, milestones, ordering and length. It was written before the host wiring and the UI. One expectation about how same-moment items are ordered was wrong in the test and was corrected; the code was right.
- `tests/onboarding.mjs` checks the counts, the portrait chip and the story (`artifacts/memory-together.png`, checked by eye).
- `pnpm preflight`: 968 passed, 19 skipped. `pnpm build` and `pnpm test:scripted` pass, hidden.

## Review

Standards and Spec reviews in parallel. Both found the same **blocker**: the journal keeps its last 40 entries and the diary its last 80, so after the 41st task "认识第 N 天" could shrink, "一起完成" stopped at 40 and "第一次" moved to a later task. **Fixed:** a running tally in settings (`together`: since, done, first task, milestones as they happen), seeded once from the existing records on upgrade, advanced when a task finishes, taken back on undo (`packages/shared/relationship.ts`, `tests/host-together.test.ts` with a tally of 59 tasks). Every tenth task is marked when it happens; it is no longer derived from whatever the journal still holds.

Should-fix, fixed: the timeline has a visible heading (我们的故事); the first task is no longer listed twice; the tab is called 我们 and the sheet's subtitle names it; a missing or unknown purpose no longer prints "undefined"; the fixed sleep before the idle-frame check is now a wait for two differing frames.

Nits fixed: the portrait is a labelled group; timestamps compare by `Date.parse`; a clock behind the first record still shows day 1; 0 agreements reads 还没有约定; with memory off the portrait says those are from before; at most 8 chips per kind plus 还有 N 条.

Not changed: opening the sheet on 我们 by default was tried and reverted (the brain chip opens the same sheet and must land on the brain); colours are literal like the rest of `style.css`.
