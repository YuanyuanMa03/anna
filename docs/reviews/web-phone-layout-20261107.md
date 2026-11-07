# Review: online demo phone layout (2026-11-07)

Branch `fix/online-mobile-layout` → `release/online-v1.0.1` (PR #63). Scope: the ModelScope Studio web edition on
phones; CSS inside `@media (max-width: 600px)` plus a new acceptance script. Desktop (>600px) is untouched.

## Report

Scanning the Studio QR code on a phone showed a page whose text was all covered.

## Cause

v1.0.1 made the desktop `.stage` fill the scene (`position: absolute; inset: 0`). The online phone block only set
the stage's height, so the stage left the column and the speech bubble, starter prompts and tour card were drawn on
top of her; the glass cards made the text unreadable. The gaze-driven inline `width` on `.speech` also beat the
phone block's `width: auto`.

## Fix

- `.stage` back in the column (`position: relative; inset: auto`), also as `.app-shell.life-onboarding .stage`,
  which outranks the later desktop `.life-onboarding .stage { right: … }`.
- `.speech { width: auto !important }`, `.speech.quiet { opacity: 1 }` (no hover on a phone to bring faded words
  back), body form's floor hidden, onboarding sheet at full phone width.
- `tests/web-phone.mjs` (`pnpm test:web-phone`): built web server with a fake key, 375×812 / 390×844 / 360×740;
  first screen, onboarding, body form and faded reply; fails on any text over the stage, off screen, faded, a stage
  off screen or too short, or sideways scroll.

## Findings

| Severity | Finding | Resolution |
| --- | --- | --- |
| High | Text drawn over the stage on phones (the report). | Fixed; test red before (15 overlaps), green after. |
| High (Standards + Spec review) | First guard `.life-onboarding .stage { inset: auto }` lost to the later same-specificity desktop rule; with `position: relative` her stage moved ~260px off screen during onboarding / `firstTaskPending`. | `.app-shell.life-onboarding .stage`; test forces the onboarding state and checks stage bounds (red on 9393738, green now). |
| Medium (Spec) | `.speech.quiet` fades her reply to .28 after 15 s; phones cannot hover it back. | Opacity 1 on phones; test checks it. |
| Medium (Spec) | Onboarding sheet squeezed to 62vw on phones. | Full phone width. |
| Medium (Standards) | Script cleanup: no spawn `error` listener, temp dir removed before the server exited, fixed port range. | Error listener, bounded wait for exit, `rm` retries, free ports from the OS. |
| Low (Standards) | Script defaulted to installed Chrome. | Playwright's Chromium first, installed Chrome as fallback. |
| Low (Standards) | Missing build gave an unclear failure. | Explicit error when `dist/web-server.js` is missing. |
| Out of scope | Landscape phones / 601–1100px keep the desktop overlay design (fixed speech, floating props). | Not the reported bug; left as is. |

## Process issue found while pushing

Pushing from a linked worktree, git hands the hook an absolute `GIT_DIR`; `scripts/pre-push.mjs` passes its
environment to the tests, and the visitor-seed test then committed its demo project into the pushed branch and set
`core.bare=true` in the shared `.git/config`. Recovered with `git reset --mixed` to the reviewed commit and
`core.bare=false`; no remote ref was affected. This push was made from the main checkout. The hook fix (strip
`GIT_*` before preflight) is a separate change.

## Verification

- `node tests/web-phone.mjs`: ok (and red against 9393738 for the onboarding state).
- Browser pane at 375×812: stage, reply bubble, prompts, tour card and failure card in order, no overlap.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (1031 passed / 19 skipped), pre-push preflight.

## Deploy (owner approved in chat, 2026-11-07)

- PR #63 merged into `release/online-v1.0.1` → 17f5ea9.
- Built from 17f5ea9 (`pnpm build:web`, phone check ok), packaged with `scripts/package-modelscope.mjs`; the Studio's
  existing `package-lock.json` kept (the package step re-resolved AWS SDK transitives, unrelated to this fix).
  `dist/web-server.js` and `dist/web-core.js` byte-identical to the previous deploy; only the renderer bundle and
  `DEPLOYMENT.md` changed.
- Studio commit 4acfcc5 ("Deploy from 17f5ea9"); build log SUCCESS with image tag `369790-4acfcc5b-…`; run log
  `Anna web listening on port 7860 (per-visitor users)`; status Running on free `platform/2v-cpu-8g-mem`.
- Rollback: Studio commit 648a25e.

## Not verified

- A real phone against the live Studio: `ms.show` answers 403 from this network, so the owner's phone scan is the
  live check.
- The test is manual (`pnpm test:web-phone`), not part of `pnpm preflight`.
