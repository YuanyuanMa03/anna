# Anna appearance: improve the current portrait's behavior

2026-11-05. Base: `2457cd309775f4f1c71351b0baa10f066d6bd7bb`, branch `work/anna-senses-v1-20261103`.

The user chose to optimize the current Anna rather than adopt a new character design during the 48-hour event. This change retains the existing portrait, eye/mouth artwork, avatar archive, room, and saved appearance preferences. It targets attention, repeated work gestures, and audio-driven mouth motion. It does not claim that aesthetic acceptance or the Intel target-machine acceptance is complete.

## Findings and fixes

- **P2: silent text and fixed rhythm drove the mouth.** `app.vue` treated streamed text and mode captions as speech; `body-stage.vue` then used a synthetic 6.5-syllable/second clock regardless of the audio. Remove that path. Decode the generated audio with an offline audio context, extract 20 ms loudness windows, and sample them against the actual audio element's playback time. The mesh stage and existing Live2D fallback use this signal. This is volume-driven animation, not phoneme recognition or precise vowel alignment.
- **P2: continuous pointer motion produced continuous attention.** The whole window refreshed the follow timer. Only movement over the visible character now requests attention. An approximately 1.8-second glance is followed by a 4.2-second break even with continued motion; leaving the character, leaving the window, or losing focus releases tracking. Typing and explicit touch reactions remain available.
- **P2: work gestures repeated with little rest.** Thinking previously repeated after 4.2 seconds despite the motion itself lasting 3.6 seconds. Work gestures now repeat at 12–18-second intervals. Waiting for approval performs its entry tilt once instead of repeatedly prompting the user. Existing idle movement, blinking, reactions, framing, and the portrait-stabilization rig are retained.

## Review of lifecycle and boundaries

- Offline decoding does not connect to an audio destination, capture a device, or alter the original audio element's output route. Decoding failure leaves original audio playback available with no invented mouth rhythm.
- Stop, buffering, pause, playback failure, completion, and teardown clear the loudness signal and animation frame. A per-playback meter epoch rejects callbacks from a previous buffering interval. Cancellation during decode cannot start playback later. Existing speech request cancellation, Blob URL cleanup, and per-turn sentence ordering remain in place.
- No Host contracts, credentials, user data formats, permission rules, dependencies, model resources, or production configurations change. The additional component amplitude prop defaults to zero. The obsolete synthetic voice helper has no remaining consumers.
- Current HEAD has no hosted workflow run. The latest branch run is Local hearing `41734886201`, on older `8e37342`; jobs and the macOS job log were inspected as baseline context only. They do not validate this change. No hosted workflow was dispatched.

## Validation

- Before implementation, regression tests reproduced continuous attention, insufficient rest between work gestures, and the missing waveform callback (3 failures).
- Local environment: macOS arm64, Node 24.21.0 through pnpm. `pnpm hooks:install` installed this clone's push guard.
- `pnpm preflight`: lint, typecheck, 707 unit/integration tests passed and 19 skipped; repeated after the final callback-epoch review fix.
- A final repeat was interrupted by laptop clamshell sleep: `pmset -g log` records sleep at 2026-11-05 11:19:57 +0800 for 943 seconds, matching tests reported at approximately 941 seconds and simultaneous unrelated timeouts. The next routing assertion saw a leftover request after that timeout. This failed run is retained as environmental evidence; no production or test timeouts were increased. The five affected files passed all 49 tests on targeted rerun. The subsequent full preflight passed, with 707 passed / 19 skipped in 15.72 seconds for the test phase. `caffeinate -i` was scoped to these verification commands; no persistent power setting was changed.
- `pnpm build`: passed. Existing Cubism script, WASM URL/externalization, and chunk-size warnings remain visible.
- `pnpm test:scripted`: all three flows passed (desktop, onboarding, unconfigured), with no page errors. The new desktop case uses real Chromium offline decoding of an explicitly synthetic WAV and a mocked audio element/clock; it verifies silence, sound, stop, and late events without speakers. It is not an acoustic or real model acceptance test. Evidence: ignored `artifacts/scripted-acceptance.json`.
- Captured the actual 900×680 desktop renderer for a short idle/pointer/typing preview using the common desktop launcher and isolated scripted settings. No message was sent, no model was called, no media device was opened, and no audio was played. Preview: ignored `artifacts/appearance-current-v1.mp4`; still: `artifacts/appearance-current-v1.png`. This is a visual review aid, not proof that the uncanny appearance is resolved.
- Real speech audio quality, a person's aesthetic judgment over prolonged use, physical devices, packaged applications, Windows/Linux, and the organizer's Intel machine are unverified for this revision. No merge, release, installation replacement, or deployment is part of this change.

Review result: the complete local diff and new source/test files were inspected against the stated base, including playback cancellation, late results, model/appearance switching, preference persistence, and platform assumptions. No known code blocker remains for this local candidate; visual approval and target-device acceptance remain outstanding.
