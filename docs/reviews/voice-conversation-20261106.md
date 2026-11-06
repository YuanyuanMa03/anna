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
- `pnpm preflight`: 976 passed, 19 skipped (after the review fixes). `pnpm build` and `pnpm test:scripted` pass, hidden. The suite caught the squeezed text box, which is now fixed.

## Not verified

- **Real device capture.** Electron's fake capture device never answers `getUserMedia` here, so the test injects a stream in its place. A test window hidden from the Dock cannot show macOS's own microphone prompt.
- Real speech, real recognition and real synthesis latency (MiMo synthesis took 4.6–38.6 s in earlier measurements). The reply is synthesised after the whole answer arrives, not while it streams.
- Echo with real speakers. Barge-in relies on Chromium's echo cancellation plus the higher threshold.
- Windows and Linux.

## Review

**Standards review: one blocker, fixed.** A double-click, or closing the app while the microphone was opening, could start a second conversation, or one nobody could stop, leaving the microphone live with no indicator.

- Each talk now has a session number. A start that returns after the talk was ended or the app was unmounted closes its microphone at once.
- 结束对话 also cancels a talk that is still starting.
- `tests/voice-talk.mjs` double-clicks and then checks that every audio track has ended.

Should-fix, fixed:

- **Failed start:** if setup fails after the microphone opened, both the microphone and the AudioContext are released. The context is resumed explicitly.
- **Noise floor:** her own voice (the raised bar) no longer teaches the noise floor. New test.
- **Her reply:** while it is being synthesised, sound is ignored, and the pill says 要开口了….
- **Encoding errors:** these now log and say 没听清, instead of being swallowed.
- **The test:** it now checks that the stream's tracks really ended.

**Spec review: no blocker.** Should-fix, fixed:

- **Ending the talk:** stops her voice and restores the earlier 模型语音 setting.
- **Slow synthesis:** the pill says 要开口了… while synthesis runs, so stray noise can no longer cancel her reply.
- **While she thinks:** the pill says 在想…（这会儿听不到）.
- **Pending approval:** an open approval card shows 等你确认.
- **Her body:** it leans in while you talk, as it does while you type. This reaches her own body; the Live2D form has no listening input yet.
- **Empty or failed recognition:** shows 没听清，再说一次？.

Nits fixed: Escape ends a talk, and a transcript from an ended talk is dropped.

Not changed:

- A voice setup saved without a key passes the start check and fails at the first utterance, with a message.
- With only recognition configured, the talk is refused rather than answering in text.
- Words spoken while she thinks are dropped, not sent as an interjection.
- Her reply is synthesised after the whole answer arrives.
- ScriptProcessorNode is still used rather than an AudioWorklet.
