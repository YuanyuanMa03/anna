# Persona, stage lines and background desktop tests — 2026-11-06

Branch `codex/stage-polish`, PR #56, stacked on #55. Items 3–5 of the 1.0 plan.

## Change

- **Persona.** `plugins/anna-persona/persona.md` gains Anna's own character (curious, opinionated, warm without clinging, a little wry, honest about limits, a continuing companion) and what not to sound like (no "as an AI" breaks, no customer-service voice, no flattery, no emoji piles). Her card in `packages/character/manifest.ts` is fuller. Each personality card now adds one concrete habit per axis (`packages/character/personality.ts`), and the user's preferences are given in words instead of enum values.
- **Stage.** The dashed tether from her hand to the card she holds is gone (SVG overlay, path code and CSS).
- **Desktop tests on a Mac run hidden.** `tests/desktop-launch.mjs` sets `ANNA_TEST_RUN=1` and, on macOS unless `ANNA_TEST_SHOW=1`, `ANNA_TEST_BACKGROUND=1`. With both, `apps/desktop/main.ts` creates the window hidden (`show: false`, `paintWhenInitiallyHidden`, no background throttling), uses the accessory activation policy (no Dock icon, no focus) and shows no system notifications. `tests/desktop.mjs` now launches through `desktopLaunch` too.

## Findings and fixes

Standards review (no blockers):

- Should-fix, fixed: this record.
- Should-fix, fixed: one variable could hide the installed app with no way back. Background now needs two flags that only `desktopLaunch` sets, and the tray's 显示 always shows the window.
- Nits fixed: no system notifications in background runs; the dangling `propsColumn` ref removed; the unrelated `.speaker small` rule restored; T cards versus gentle advice: the user's chosen advice style wins; E cards no longer "find something to say" when quiet; "one question at a time" allows a single checklist.
- Not changed: `tests/packaged-smoke.mjs` still launches directly (it predates this change and reuses the real keychain item, so it is not run on this Mac); `setActivationPolicy` is already macOS-only.

Spec review (no blockers):

- Should-fix, fixed: `tests/desktop.mjs` bypassed `desktopLaunch` and still opened a window. It now uses it. Because it makes real model calls with the owner's key, it was not run; instead the WebGL idle-frame check it held was added to `tests/onboarding.mjs`, which passes hidden and shown.
- Should-fix, fixed: "never say 'as an AI'" could make her dodge a sincere question. She now says plainly that she is an AI program running on the computer when sincerely asked.
- Should-fix, fixed: "notice small details" and "we did … last time" invited invented shared history. She now mentions only what the diary and work records actually say, and never pretends to remember.
- Should-fix, fixed: personality card versus advice style conflict (as above).
- Nits fixed: she may talk about her on-screen look and motion but claims no touch, pain, hunger or human experience; `ANNA_TEST_SHOW=1` is documented in both READMEs.
- Not changed: the tray icon still appears in the menu bar during hidden runs (the scripted flow reads its menu).

## Verification (macOS arm64)

- Tests first: `tests/persona.test.ts` failed before the persona change (distinct cards, preferences in words, honesty lines).
- `pnpm preflight`: 959 passed, 19 skipped. `pnpm build`; `pnpm test:scripted` passes hidden; `ANNA_TEST_SHOW=1 node tests/onboarding.mjs` passes shown. Onboarding asserts the window's visibility both ways and that her idle animation advances.
- Screenshots taken hidden render fully (`artifacts/onboarding-personality.png`); `artifacts/scripted-approval.png` shows the held card with no line.
- Intermittent: `tests/install-script.test.ts` hit vitest's 5 s timeout once under a full preflight and passed alone and on the next full run (as `pre-push.test.ts` did in #55). Several tests sit near that limit under load.

## Not verified

- `tests/desktop.mjs` with a real model (needs the owner's go-ahead for real API calls).
- How the new persona reads in real conversations; that needs real model calls too.
- Windows and Linux (background mode is macOS-only; both still show the window).
