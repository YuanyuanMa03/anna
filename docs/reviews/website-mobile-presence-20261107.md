# Website: first encounter and phone layout (2026-11-07)

Scope: `codex/website-mobile-presence`, starting at `codex/body-calm` / `1d81b78` (the already-published v1.0.1 website/media sync). Landing page at `anna.mayuanyuan.top`; the actual Cloudflare custom domain maps to Worker `anna`, confirmed read-only through the Cloudflare connector. No website deployment or merge is included in this change.

## Intent and visual review

Make the QR visitor's first minute about Anna as a digital life: her appearance, a clear greeting, companionship and memory, then actual conversation or desktop installation. Keep the established bilingual slogan and existing artwork. The hero now uses her original portrait, restrained plum/rose tones, a circular frame and two clear calls to action. The interactive form preview explains initial encounter, personality and reunion; it explicitly links to the separate real online experience.

Complete source diff reviewed against `1d81b78`, including bilingual copy, metadata, header navigation, touch/keyboard input, render cancellation, object URL ownership, reduced-motion behavior and desktop reuse. Against main this branch also includes the prior website media/copy sync and its existing review records; those are not a new app-runtime release.

## Findings and fixes

- **P1, fixed: first encounter hidden below the phone fold.** Production Chromium at 375×812: the first `.duo-canvas` started at y=814.95px. Four competing hero buttons and a long paragraph appeared before any portrait. Added a high-priority portrait in the hero, concise copy and two primary paths; desktop download remains an anchor below them.
- **P1, fixed: revoked texture URLs during renderer cancellation.** Introducing visibility-based mounting exposed ten `blob:... ERR_FILE_NOT_FOUND` errors when the original body renderer was replaced while its texture/silhouette reads were pending. `body-stage.vue` now retains the package until both reads settle; it still destroys the renderer and releases its context on unmount. If opening the package completes after unmount, the existing disposed check releases it immediately. Rapidly switching forms four times, waiting for each final ready state and scrolling away now produces zero failed requests and zero page errors.
- **P2, fixed: redundant off-screen renderers.** Original page mounted two form previews plus the task renderer. Async imports and IntersectionObserver now mount one visible stage/form; scrolling to the lower page returns the canvas count to zero. The hero remains an image and can render without WebGL. The original body fallback remains available.
- **P2, fixed: mobile navigation disappeared and desktop download was misleading.** The old phone header hid all section links and iPhone/Android were assigned the Mac installer. The hero now links to a desktop-install section instead of a DMG; mobile visitors get explicit computer-only guidance. A 44px-target Explore menu provides section navigation, closes after navigation and resets on language switch. Installer choices remain available for visitors intentionally downloading for another machine.
- **P2, fixed: phone illustration and controls scale poorly on narrow screens.** The remote-phone preview is bounded at 250px instead of stretching to the column width; phone stage has sufficient height, captions fit the card, controls and logs wrap at 320px. Hover lift is limited to hover-capable devices.
- **P2, fixed: reduced-motion video and demonstration attribution.** Reduced motion suppresses the autoplay attribute; rejected `play()` promises are handled. Both languages now state that the real-app video uses scripted replies/test speech and is not a live model conversation, matching `website/README.md`.
- **P2, rechecked: brand contract.** An early alternate headline failed `brand-voice.test.ts`. Final code retains the established bilingual slogan/title/footer. The focused seven brand checks pass without weakening the test.

## Verification

- `pnpm build:website`: passed. Async split emits the small entry separately from the body and Live2D renderer. Live2D's chunk-size notice and the existing separately-copied room/core asset notices remain non-fatal.
- `pnpm preflight`: passed, including lint, typecheck and 997 passed / 19 skipped unit/integration tests.
- `pnpm build`: passed, because the body renderer is shared with desktop.
- `pnpm test:scripted`: passed: desktop task/approval flow, onboarding, unconfigured first run, startup failures, voice talk. Models, microphone recognition and speech are synthetic/scripted acceptance, not provider acceptance.
- Real installed Chrome through Playwright CLI: both languages at 320, 375, 390, 430, 768 and 1440px; no horizontal document overflow or out-of-bounds links, buttons, headings, paragraphs or remote-phone illustration.
- Mobile menu open/navigation; body and anime reach `data-state=ready`; explicit greeting displays feedback; rapid cancellation produces zero request failures/page errors; off-screen canvas count zero.
- Scripted web demo in Auto: delivery contains notes.md and package.json; Undo sets `delivery undone`.
- Emulated reduced motion: video `{ autoplay: false, paused: true }`.
- Visual screenshots inspected for the mobile hero, interactive preview and desktop hero. Screenshots are local artifacts, not committed third-party assets.

## Boundaries

Not published. No hosted workflow was dispatched. Chromium's phone viewport and touch/user-agent emulation do not establish physical iOS Safari or Android acceptance. Cross-platform packaged-app acceptance for this exact shared-renderer revision has not run; inspect it before merging a runtime release per AGENTS.md. The website preview does not connect to a model; genuine model/voice/memory use belongs to the linked Studio/desktop app. Visual appeal is a design goal, not a verified guarantee of audience response.
