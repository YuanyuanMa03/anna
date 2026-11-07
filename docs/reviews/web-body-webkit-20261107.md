# Review: the body form on WebKit phones (2026-11-07)

Branch `fix/web-body-webkit` → `release/online-v1.0.1`. Scope: one hunk in the existing
`patches/mesh-avatar@0.4.0.patch` (plus its lockfile hash). No app code changes.

## Report

On a phone, every browser (and WeChat) showed the demo without her own body — only the anime form or
a broken stage. Desktop access was fine.

## Investigation (evidence under `output/studio-render-diagnosis/`)

- Live Studio, logged-out phone emulation (WebKit and Chromium, `probe-live.mjs`): no login wall, the
  `ms.show` iframe loads, `.scene[data-form=body]`, no failure alert — but the WebKit screenshot shows
  a stage with only a pair of floating realistic eyes. The base layer does not draw; nothing reports it.
- Instrumented local build (`probe-webkit.mjs`): on WebKit the `base.png` (1672×941) `texImage2D` fails
  with GL 1281 `INVALID_VALUE`; its `generateMipmap` then fails 1282; every small eye texture uploads
  cleanly. Canvas readback: 0.4% of pixels drawn (WebKit) vs 34% (Chromium, same build, same machine).
  `MAX_TEXTURE_SIZE` is 16384 on both, so it is not a size cap.
- The image is `complete: true, naturalWidth: 1672` at upload time: WebKit fires `onload` before the
  bitmap can actually be uploaded. Blink tolerates this; WebKit rejects the upload.
- In-vivo retry through the same context: re-uploading after `await img.decode()` → err 0; uploading a
  2D-canvas copy → err 0. Isolated repros of the fetch/blob/parallel-upload paths all pass, so the
  trigger is the app's real load timing, not the asset or the archive.

## Fix

`mesh-avatar`'s single image loader (`lt()` in `dist/index.js`) hands the `Image` over at `onload`;
the patch now waits for `decode()` to settle first (and still resolves on decode failure, preserving
the old behaviour for a broken image). This is the only path through which layer, sprite and overlay
images reach `texImage2D`.

## Findings

| Severity | Finding | Resolution |
| --- | --- | --- |
| High | Body form broken on every WebKit surface: iOS Safari/Chrome/WeChat (all WKWebView) and macOS Safari desktop; base layer silently missing. | Fixed by the patch; verified below. |
| Medium | The failure is silent: `data-state="ready"` while 99.6% of the stage is empty — a visitor cannot tell a broken stage from a designed one. | Not addressed here; the upload no longer fails, so the silent path itself is gone. A `gl.getError` audit in `mesh-avatar` would be an upstream follow-up. |
| Low | Same patch ships to the desktop renderer; Chromium behaviour unchanged (decode of a loaded image resolves immediately). | Full suite green; accepted. |

## Verification

- `node output/studio-render-diagnosis/probe-webkit.mjs webkit` after rebuild: `drawnShare` 0.341
  (was 0.004), zero non-clean texture events, screenshot shows the complete body.
- `pnpm test:web-phone`: ok. `pnpm lint`, `pnpm typecheck`: clean. `pnpm test`: 1031 passed / 19 skipped.
- Not verified: a real phone and WeChat's X5 (Android) — WebKit is covered by Playwright's engine;
  the owner's phone scan after deploy is the live check. X5 without WebGL2 keeps the documented
  anime fallback by design.

## Deploy

Owner asked for the demo experience to be fixed; deployed with the new `pnpm deploy:studio`
(PR #67 + the watcher follow-up 27c5022, which landed on the release branch directly after the first
run exposed a replaced-log misreport — hook-verified, content identical to the intended PR):

- Studio commit 4ee51fe "Deploy from 1e2a9b11 (#67)", image `369790-4ee51fe8-2026-11-07-11-56-50`,
  run log `Anna web listening on port 7860` at 12:03.
- Live acceptance (`output/studio-render-diagnosis/verify-live.mjs`, iPhone viewport): the Studio
  iframe serves bundle `index-Cg1xQ6jo.js`; `.scene[data-form=body]`, state `ready`, canvas coverage
  0.340 (WebKit) / 0.344 (Chromium); screenshot shows the complete body on WebKit.
- Rollback: Studio commit 4acfcc5.

One cosmetic leftover seen while verifying: the web edition's header still reads `v1.0.0` while the
desktop line is at v1.0.1 — version-string plumbing in the web build, separate from this fix.
