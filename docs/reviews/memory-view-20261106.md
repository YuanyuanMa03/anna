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
- `pnpm preflight`: 963 passed, 19 skipped. `pnpm build` and `pnpm test:scripted` pass, hidden.

## Review

Pending: Standards and Spec reviews.
