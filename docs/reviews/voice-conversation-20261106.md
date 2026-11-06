# Talking with her (hands-free voice) — 2026-11-06

Branch `codex/voice-conversation`, stacked on #57. Item 7 of the 1.0 plan.

## Change

Voice and chat share one box. **和她说话** next to the text box opens the microphone and keeps listening:

- `apps/desktop/src/endpointer.ts` finds where speech starts and stops from frame loudness. It learns the room's noise for the first half second, needs 200 ms of speech to start, and ends after a 900 ms pause or 30 s.
- `apps/desktop/src/conversation.ts` captures raw audio with 400 ms of pre-roll and turns each utterance into a 16 kHz WAV. Nothing is kept between utterances.
- Each utterance goes to the saved recognition service and then straight to her current brain as a message, with no confirmation step. Her reply is synthesised and spoken (model speech is switched on).
- Speaking over her stops her voice. While she plays, speech must be four times louder to count, which keeps her own voice from triggering it.
- While recognising or while she is thinking, what is heard is ignored.
- A status pill shows the state: 在听 / 在听你说 / 在听懂 / 在想 / 在说（开口就能打断）.
- **结束对话**, closing the app, or the device going away releases the microphone at once. Anna's own microphone permission dialog still asks first.
- Without a saved recognition and synthesis setup, the button opens **语音设置** (the old 语音对话 sheet, unchanged) and says why.
- While talking, the model-speech toggle and 停止说话 are hidden. The chat box now wraps its controls onto a second line instead of squeezing the text box.

Speech goes through her brain, never a direct speech-to-speech model, so memory, tools and permissions stay hers.

## Verification (macOS arm64)

- Tests first: `tests/endpointer.test.ts`, with six cases (a sentence, a click, pauses inside a sentence, steady noise, too long, barge-in threshold). Two cases failed against the first version: steady noise was heard as speech before the floor was learned (fixed with the warm-up), and one test expectation about a cut utterance was wrong.
- `tests/voice-talk.mjs` (added to `test:scripted`) covers the whole chain: synthetic microphone stream → voice activity → loopback fake recognition → scripted reply → synthesis. It then checks that 结束对话 closes it, and that exactly one utterance was sent. Screenshot: `artifacts/voice-talk.png`.
- `pnpm preflight`: 975 passed, 19 skipped. `pnpm build` and `pnpm test:scripted` pass, hidden. The suite caught the squeezed text box, which is now fixed.

## Not verified

- **Real device capture.** Electron's fake capture device never answers `getUserMedia` here, so the test injects a stream in its place. A test window hidden from the Dock cannot show macOS's own microphone prompt.
- Real speech, real recognition and real synthesis latency (MiMo synthesis took 4.6–38.6 s in earlier measurements). The reply is synthesised after the whole answer arrives, not while it streams.
- Echo with real speakers. Barge-in relies on Chromium's echo cancellation plus the higher threshold.
- Windows and Linux.

## Review

Pending: Standards and Spec reviews.
