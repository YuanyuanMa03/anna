# Desktop voice and distribution review — 2026-11-05

## Scope and intended base

Base: `4e19b91` on `work/anna-senses-v1-20261103`. Implementation branch: `codex/desktop-voice-slim`. Requested scope: remove the local New API/gateway/workbench and desktop camera/screen/vision features, retain voice conversation with local/cloud ASR and TTS, preserve existing brains and other desktop capabilities, and reduce distribution size/file count.

The review covers all changed runtime/UI/build files, new and removed tests, dependency/lockfile changes, installer resource paths and documentation. Removed gateway/vision/hearing tests belonged to removed implementations. Speech lifecycle and microphone ownership coverage are retained; new direct ASR, conversion and dependency-staging tests replace the removed WASM path. Historical specifications and review evidence remain marked as retired.

## Findings and fixes

- **P1, fixed: expanded production dependency graph.** The baseline Windows ZIP contains 132,172 files / 1,508.9 MiB, including 1,117.8 MiB of `node_modules`. Top-level and pnpm links are dereferenced into repeated copies. The new build records actual Host externals, stages each canonical dependency once, preserves distinct versions/required peer contexts, and archives JS/assets into `app.asar`. Optional development peers (including Electron/TypeScript) are excluded; the Electron runtime is the outer app. Conflicting dependency versions and archive links are tested with synthetic fixtures in a path containing spaces/non-ASCII.
- **P1, fixed: spawning archived sandbox helpers.** Sandbox vendor executables/JVM helper cannot be treated like normal archived JS. Its dependency closure stays beside the archive on the real filesystem. Other native addon extensions are unpacked. Mac package startup was checked with `NODE_PATH` empty and resolves Valibot inside `app.asar`, rather than the checkout.
- **P1, fixed: stale compiled features.** TypeScript does not delete outputs for removed source files. The Host build now clears only generated `dist/host` before compilation, so deleted gateway/senses modules cannot leak into a later distribution.
- **P2, fixed: installer icon paths.** NSIS and its installation checks previously referenced `resources/app/dist/renderer/anna.ico`. Icons now live beside `app.asar`, and installer/check paths were changed together.
- **P2, fixed: service credentials and configuration races.** ASR/TTS use separate keys in the existing OS-backed vault. Endpoint changes require a replacement/explicitly empty key. Concurrent saves and saves during inference are rejected before reading/writing the vault, preventing lost updates or endpoint/key confusion. Cancellation is registered before a pending credential read; responses are bounded and provider error bodies are never surfaced.
- **P2, fixed: changing/reopening voice settings.** Saving the last missing service no longer collapses settings during editing. Settings initialize closed when both services exist, without overwriting a user's explicit expansion during asynchronous load. The mode selector has an explicit accessible label, so its option text does not become part of its label.
- **P2, fixed: synthetic conversion edge case.** Non-finite neighboring PCM values previously contaminated valid samples through `NaN * 0`; conversion sanitizes each source sample. Tests cover clipping, stereo downmix, resampling and invalid/overlong input. This is implementation validation, not an audio-quality claim.
- **P2, fixed: pnpm launch semantics.** Build scripts invoke the actual JS or native pnpm entry with argument arrays. They do not concatenate arguments into a Windows `.cmd` shell. The local native pnpm executable and CI's JS entry are handled separately.

## Persistence, permissions and rollback

- Existing TTS configuration/keys retain `senses.bin`; legacy mode is inferred without rewriting its stored contents. ASR adds separate fields. Other brains, memories, sessions, agent/provider configuration and Weixin code are unchanged.
- Existing `vision.bin`, `hearing-model`, New API databases and independently installed/running services are not read, removed or stopped. Their legacy data paths remain protected from agent tools.
- The bridge exposes voice requests only to the main frame. Main no longer offers screen sources or vision IPC; camera/display capture requests are denied. Only explicit microphone capture is supported, and a late grant is stopped after cancellation. Closing the voice panel releases capture and aborts its pending request.
- Local endpoints are loopback only; cloud endpoints require HTTPS. Recognition uploads bounded PCM WAV through Host; keys do not enter Renderer status. Responses and recording duration have explicit bounds. Model inference is never auto-started or downloaded.
- Reverting to the previous application leaves user data intact. The new ASR fields are additive to the legacy TTS vault; the old implementation reads its existing TTS fields and ignores the additions. Desktop updater/swap behavior is unchanged.

## Verification record

- macOS arm64, Node 24.21.0: `pnpm preflight` passed with **674 tests passed, 19 skipped** (73 passing files, one opt-in real-agent file skipped).
- `pnpm build` passed. Existing Vite notices about the Cubism non-module script and the large JS chunk remain; no new build errors.
- Python 3.12, NumPy 2.0.2: `python scripts/local-speech/test_server.py` passed **6** local HTTP protocol tests using a synthetic waveform and fake recognizer. No real model or audio device was used.
- The packaged macOS candidate starts from `app.asar` with checkout `NODE_PATH` removed. Initial macOS package: about **389 MiB app / 151 MiB ZIP**, about **101 MiB resources**, 817 physical app files (550 resource files), 238 archived packages plus five external sandbox packages. This is not a same-platform comparison with the old Windows package.
- `pnpm test:scripted` passed the complete source desktop flow (22 recorded checks), onboarding and unconfigured startup with zero renderer errors. The flow uses synthetic WAV/fake speech HTTP, fake agents and mocked playback. The final `ANNA_PACKAGED_APP=dist/macos/Anna.app NODE_PATH=... pnpm test:scripted` also passed its complete packaged flow (18 recorded checks), onboarding and unconfigured startup with zero renderer errors. Packaged credentials use isolated file fixtures, so this does not assert native Keychain acceptance. Hosted Windows/Linux acceptance and real local/cloud speech are not implied by these local results.

## Remaining boundaries

The optional Python service adds native offline Paraformer ASR beside Kokoro TTS. Native model weights are not installed in this checkout. Its model loading API was checked against the upstream sherpa-onnx offline-recognition example; native inference, voice quality, real microphones and arbitrary cloud-provider compatibility remain unverified. The old streaming Sherpaw preload package is a different model format; documentation explicitly requires a compatible offline model instead. The direct API path can also use another compatible local service.

No release tag, public release, production deployment or merge is part of this candidate. A manual branch package build can produce test artifacts without publishing; target-platform evidence must be attached before calling those installers accepted.

Final local macOS ZIP SHA-256: `8e82b66a6a362a60bda57e6bd6f3d7e7332f186b124f340428c8d87dd62c195a`. Evidence files: `artifacts/slim-source-acceptance.json`, `artifacts/slim-packaged-acceptance.json`, `dist/macos/package-report.json`.

## First native package run

Runtime candidate `3185ba86ea71e2a0afbb77dc16044d79b4635f61`, manual run [42011690566](https://github.com/YuanyuanMa03/anna/actions/runs/42011690566): macOS DMG and Linux .deb installation/removal succeeded. Windows packaging and NSIS compilation succeeded, but packaged desktop startup timed out before `.scene` (no checks completed). This is a failed candidate, not Windows acceptance. The test did not retain process stderr in the report and Release skipped artifact upload after failure, so this run lacks the causal startup error. Add bounded stderr/UI failure capture and always-upload diagnostics, then reproduce only the Windows package/startup step before another full matrix. No timeout increase or unchanged-code retry.
