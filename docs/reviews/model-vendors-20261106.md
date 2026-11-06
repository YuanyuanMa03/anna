# Model vendor tiles — 2026-11-06

Branch `codex/provider-model-setup`, PR #55, stacked on #54.

## Change

Onboarding step 3 ("接通模型") offered DeepSeek or a bare custom endpoint. It now shows one tile per vendor (DeepSeek, Kimi, Zhipu GLM, Qwen, Xiaomi MiMo pay-as-you-go and Token Plan, MiniMax, Doubao, StepFun, SiliconFlow, OpenRouter, OpenAI, Anthropic, Gemini) and a custom endpoint. A tile links to the vendor's key page. Typing a key fetches the chat models it can use, in the host (`packages/anna-host/model-list.ts`), so a saved key never reaches the renderer. DeepSeek keeps pi's own catalogue and is not listed.

## Findings and fixes

Found before review (test first):

- **Saved key sent to another vendor.** `configure` with an empty key reused the saved key whatever the new address was, so switching vendor without typing a key sent the old key to the new endpoint. A saved key now only goes back to the address it was saved for (`sameEndpoint`), in `configure` and in the model list.

Standards review (no blockers):

- Should-fix, fixed: the list fetch held the app-wide `busy`, locking the form for up to 15 s. `model-list` no longer owns it.
- Should-fix, fixed: an older answer (a partial key's 401) could overwrite a newer list. Only the newest request answers; a new one aborts the previous.
- Should-fix, fixed: a save to another vendor landing between the address check and the vault read could pair the new key with the old address. The address is checked again after the read.
- Should-fix, fixed: this record.
- Nits fixed: errors while reading the body, and a malformed address, now show Chinese messages and release the reader; the timeout also bounds a body that stops halfway (a test reproduced the hang); request and key-format errors show on the form instead of the app-wide error; the progress timer is cleared on unmount; the selected tile follows settings changed elsewhere; Gemini's `models/` prefix is stripped.
- Not changed: Anthropic's list reads one page of 1000, its documented maximum.

Spec review (no blockers):

- Should-fix, fixed: DeepSeek's real list could offer IDs pi's catalogue rejects. DeepSeek no longer fetches; it offers its catalogue models.
- Should-fix, fixed: vendors without suggestions left the model box empty. A list that arrives fills an empty box (`firstModel`), and replaces a suggestion the key cannot use, never what the user typed.
- Should-fix, fixed: embedding, speech, image, moderation and rerank models are filtered out.
- Should-fix, fixed: a 400 or 5xx says to pick a suggested model or type the ID.
- Should-fix, fixed: the desktop acceptance now drives tile → key → list (`ANNA_TEST_MODELS`, only with `ANNA_TEST_SCRIPT`) → pick → save → connected, then checks that the saved key fits only that vendor.
- Nits fixed: picking 自定义 clears pi's catalogue model name; the DeepSeek tile no longer says "pi 内置目录".
- Not changed: 验证连接 still tests the saved settings while an unsaved tile is selected (the onboarding flow needs its label); every vendor but DeepSeek is still a custom pi endpoint (131072 context, reasoning off), as before this change.

## Verification (macOS arm64)

- Tests written first and failing before each fix: `tests/model-vendors.test.ts`, `tests/host-model-list.test.ts` (saved-key leak, stale answers and abort, errors on the form).
- `pnpm preflight`: 956 passed, 19 skipped. `pnpm build`; `pnpm test:scripted` passes, including the extended `tests/onboarding.mjs`; screenshot `artifacts/onboarding-vendors.png` checked by eye.

## Not verified

- No real vendor was called. Whether MiniMax, Doubao, Zhipu and StepFun serve `/models`, and whether Gemini's chat endpoint takes the stripped IDs, are unchecked; failures fall back to suggestions and manual entry.
- The Zhipu and MiniMax key-page links were not opened.
- Windows.
