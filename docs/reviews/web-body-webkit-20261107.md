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

Owner asked for the demo experience to be fixed; deployed per the established Studio flow (commit and
image tag recorded below after deploy).

- Rollback: Studio commit 4acfcc5.
