# Website redesign: two live forms, a recorded talk, roadmap features

2026-11-06. The owner asked for a redesigned landing page: Anna's two forms side by side and animated, the sponsor
module removed, the feature showcase switched to the newest roadmap work (which the owner confirmed is implemented
and merging soon), and a dynamic video embedded in the page. A later message added the WeChat remote-delegation
section as a framed desktop window beside a phone chat mockup.

Base: the working tree on `codex/agent-guides` at `c5f4a69`, website-only changes. No desktop runtime, no release,
no deployment: deploying the site needs the owner's explicit approval and stays a separate step.

## What changed

- `website/src/site.vue`, `copy.ts`, `style.css`: the hero's static cut-out is replaced by a "two forms" stage —
  `BodyStage` (her own mesh body) on the left, `CharacterStage` (Live2D anime form, zoom 1.5) on the right, both
  from the app's own components, both following the pointer, blinking and breathing, with a greet motion on first
  sight and a celebrate motion (plus a heart) on poke. The sponsor nav button, hero sponsor note, coffee aside and
  the payment dialog are removed. The static desktop screenshot becomes a muted autoplaying video in the same window
  frame. Features become four showcase rows (hands-free voice, brain/model vendor tiles, install guides, your time
  together) built from new screenshots, plus a WeChat remote row (window shell + phone chat shell) and a three-card
  grid (Windows permission modes, a livelier her, roadmap pointer). Bilingual copy throughout.
- `scripts/website-media.mjs` (new, maintenance): captures every asset from the real app with the scripted brain and
  fake speech endpoints — no real model, no real keys. It records wall-clock frame timestamps of an idle period, a
  work turn and a hands-free voice turn (listening → spoken answer with moving lips), then stills of the memory "us"
  tab, the brain install guide and the model vendor tiles. Frames are assembled by ffmpeg (concat demuxer with the
  real inter-frame deltas, so pacing is original) into `anna-live.mp4`; stills become webp via cwebp.
- `website/README.md`: documents the media pipeline and records that the sponsor module was removed on purpose.
- Media in `website/public/media`: added `anna-live.mp4`, `anna-live-poster.webp`, `anna-working.webp`,
  `voice-answer.webp`, `provider-tiles.webp`, `install-guide.webp`, `memory-together.webp`; deleted the payment QR
  images and the v0.6.0 screenshots no longer referenced (hero OG image `work.webp` and `anna.webp` are kept).

## Review findings

- Severity: low. The first capture run failed because `ANNA_TEST_SCRIPT` is read once at startup while the script
  rewrote the response file between turns; the voice turn then never got an answer. Fixed by writing the whole
  response queue before launch (documented in the script header). Evidence: the rerun produced a synthesis
  (`assert(syntheses > 0)`) and the speaking-scene frames show her mid-answer.
- Severity: low. Two stills were lost to a backdrop overlay intercepting clicks and to navigating the settings panel
  through the wrong dialog: all settings live in the "Anna 档案" sheet's numbered tabs. Fixed by driving the tabs
  directly (2 选择大脑 / 3 接通模型 / 我们) and closing sheets with their own close button between sections.
- Severity: low. Homebrew's ffmpeg ships without libwebp; webp encoding moved to `cwebp`. The video check on the
  website found the bottom caption chip overlapping the video window and the anime card visually sparse; fixed by
  moving the chip outside the frame and zooming the Live2D form. Re-verified with the visual judge after the fix.
- Claim honesty: the feature showcase states these come from the current iteration plan, development complete, and
  ship with the next in-app update — the owner confirmed on 2026-11-06 that the work is implemented and merging.
  Feature wording is grounded in the roadmap items and the app's own UI text (WeChat ClawBot, 1/0 approvals,
  `/status` / `/stop`, Ask mode for WeChat tasks). No claim of a shipped release.
- Privacy: all captures run against a synthetic workspace under `.data/`, a scripted brain and loopback fake
  speech endpoints; the app status bar in the footage honestly reads "scripted". No user data, credentials or real
  model output appear in the media. The microphone-permission dialog is answered programmatically, as the existing
  desktop tests do.

## Verification

- `scripts/website-media.mjs` run end-to-end: video (3.1 MB, 1280×860, ~31 s wall clock) and all four stills encoded
  into `website/public/media`; every capture visually checked (poster shows her speaking; vendor tiles show the GLM
  tile selected with a fetched model list; the memory tab shows real counts and a timeline; the install guide shows
  numbered steps and the official link).
- `pnpm build:website` clean; rendered page checked with Playwright at 1440×960 and 390×844 through a local preview:
  both duo stages reach `data-state="ready"` (2/2), the video loads (`readyState 4`, `videoWidth 1280`) and plays
  muted autoplay, no console errors, desktop and mobile layouts inspected section by section (duo, video, demo,
  features, WeChat remote, download) including the fixes above.
- `pnpm preflight` green on the committed tree: whitespace, ESLint, vue-tsc/tsc, vitest 980 passed / 19 skipped
  (the skipped ones are the real-agent tests).
- Desktop flows are untouched (`apps/desktop/src` has no changes in this commit), so `pnpm test:scripted` is not in
  scope; the capture script drives the real app but is not part of any shipped path.

Remaining risks: the recorded video's between-scene gaps (a few seconds of clicking between turns are not captured)
are unedited out rather than bridged; re-run `scripts/website-media.mjs` after any change to the voice flow or the
three panels shown. Deployment to `anna.mayuanyuan.top` is not done here and needs the owner's go-ahead.
