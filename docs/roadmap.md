# Iteration roadmap

Updated 2026-11-06. The immediate goal is a consistent macOS and Windows experience from the official website through installation, first use and updates. Existing Linux support is retained. This roadmap records requested work; a planned feature is not a claim that it already ships.

Use [architecture](architecture.md) for current behavior and [release and operations](release-operations.md) for distribution and acceptance. Review records in `docs/reviews/` retain the evidence for earlier candidates; they do not validate a later revision.

## Current foundation

- Electron main, a separate Host/core process and Vue character stages; built-in pi, Claude Code and Codex brains share Anna's persona, memory, tools and permission gate. ACP brains remain experimental and off by default.
- Resumable onboarding, folder trust, model connection verification, personality preferences and a unified profile for memory, abilities, models and work records.
- Sixteen personality styles, with legacy-profile migration and instruction assembly across supported brains. The richer personality writing below is still pending.
- Confirmed long-term memories with writer attribution, dates, correction and deletion. Explicit requests to remember are handled by the Host; proposed memories require confirmation. A profile visualization and relationship timeline are still pending.
- Sharing pi's model with compatible external agents, with preview, saved original choices, independent changes ending follow mode, restore and recovery transactions.
- Claude Code/Codex history browsing and branching, with source attribution and workspace/session isolation. Native history acceptance used temporary sessions; it did not authorize editing the user's unrelated sessions.
- Local provider routing for Claude Code and Codex, Chat Completions conversion, backup providers, failover, opt-in global configuration takeover and model aggregation. This in-process routing remains supported; the retired service gateway and workbench are not returning.
- Direct speech-service configuration, MiMo chat-format speech, cancellable playback and synthesis of the next sentence while the current sentence plays. Input currently uses recording, transcription review and explicit submission; continuous conversation is planned below.
- Live2D and mesh-avatar forms. The frontal portrait rig limits invented facial parallax; geometry tests do not establish real speech alignment or long-session visual quality.
- Lean `app.asar` distribution, packaged search tools, startup diagnostics, corrupt-JSON quarantine and Windows script launching without `shell: true` in the changed detection, install and delegation paths.

## Finish the 1.0 release line first

1. **Windows follow-up.** PR [#52](https://github.com/YuanyuanMa03/anna/pull/52), based on the draft 1.0 candidate [#51](https://github.com/YuanyuanMa03/anna/pull/51), changes GPU diagnostics and Windows script launching. The owner reported on 2026-11-06 that the retest was acceptable and asked development to continue. No new detailed evidence was supplied for the individual DEP0190, detection, install and delegation checks; do not label each of those independently verified. Earlier target-machine evidence remains in [the Windows review](reviews/v1.0-windows.md).
2. **Documentation.** Consolidate current architecture, this roadmap and release/operations guidance. Remove obsolete gateway/workbench and Linux-packaging prose while retaining Linux code and review evidence. Remove blanket restrictions against wake words or background listening; changing capture behavior still needs its own scoped implementation and authorization.
3. **Signing and installation guidance.** Ask whether a Developer ID certificate and notarization credentials are available; the owner supplies credentials through Keychain. If available, implement signing/notarization and test an upgrade from the self-signed app, including microphone/folder permissions and the `Anna Safe Storage` Keychain item. Otherwise provide screenshot-based Open Anyway instructions in the website and README. Windows 1.0 stays unsigned: feature the PowerShell installer, including its `Unblock-File` behavior, and explain More info → Run anyway for the executable installer.
4. **Clean-machine acceptance.** On both macOS and Windows, exercise website download → installation → first launch → setup → chat → voice → reopen → in-app update. The PowerShell installer and update path remain pending. Measure MiMo end-of-utterance-to-first-audio latency and verify actual 24 kHz playback and lip sync. Recorded synthesis times of 4.6–38.6 seconds are historical network/service observations, not a latency guarantee.
5. **Release with separate approvals.** Obtain explicit approval for each merge, long-lived-branch push, version change for release, release tag/draft Release, replacement of the locally signed Mac package, signed `latest.json` update and website deployment. Local checks or a ready PR do not imply release approval.

Ask the owner before scheduling new Windows hardware acceptance, arranging Git Bash, selecting the Developer ID path, defining background microphone scope or reducing acceptance scope after a failure.

## Requested feature sequence

Each numbered item has its own feature branch and draft PR. Work in the following order after the release-line preparation above.

### 1. Windows permission modes without a command sandbox

Keep macOS's current sandbox design. Compare the intended Windows semantics with the current [Claude Code permission documentation](https://code.claude.com/docs/en/permissions) before implementation.

First complete PowerShell classification and Windows path handling:

- Treat recursive `Remove-Item` switches/abbreviations and aliases (`ri`, `rm`, `del`, `erase`, `rd`, `rmdir`), forced process termination, execution-policy changes, registry writes/deletes, `Remove-ItemProperty`, elevation, `iex`/`Invoke-Expression`, ACL/ownership changes and scheduled-task creation as high risk.
- Allow the requested read-only/process/date/help/location commands and read-only `Get-ChildItem` pipelines. Cover `$PSVersionTable`, `where` and `where.exe`.
- Interpret cmd switches such as `/b` and `/s` as switches on Windows rather than outside-workspace paths. Select `path.win32` or `path.posix` from the input platform in containment checks, and test Windows rules on any test host.

Then implement Windows Plan as read-only, Ask as confirmation for modifications, Edit as direct workspace edits/tests/builds with other commands asking, and Auto as an explicitly acknowledged bypass mode for trusted folders. Persist the initial acknowledgement and provide revocation in settings. High-risk commands, outside-workspace edits and secret reads still ask every time; Anna's own data remains forbidden. Update mode descriptions, greetings and approval reasons to state the actual sandbox availability. Offer separate remembered rules for parseable compound-command parts.

### 2. Provider tiles and Host-side model discovery

Replace pi's two-choice model setup with tiles for DeepSeek, Kimi, Zhipu GLM, Qwen/Bailian, MiniMax, Xiaomi MiMo, Doubao/Volcengine Ark, SiliconFlow, StepFun, OpenRouter, OpenAI, Anthropic, Gemini, local Ollama/LM Studio and Custom.

Reuse attributable cc-switch MIT presets for addresses, protocols, key-registration pages and recommended models. Let the user open the provider's key page, paste a key and choose a searchable model list with a highlighted recommendation. Fetch models in the Host using OpenAI-compatible `/models`, Anthropic `/v1/models` or Gemini `models.list`; do not return saved keys to the renderer. Fall back to preset recommendations and manual model entry when discovery fails or is unsupported. Preserve connection verification and sharing pi's model.

### 3. Background macOS desktop acceptance

Keep every launch on `tests/desktop-launch.mjs`. Default macOS automatic launches to a test-only background mode, with `ANNA_TEST_SHOW=1` restoring a visible run. Use accessory activation policy and initially hidden, continuously painted/unthrottled windows; use `showInactive()` only if required by screenshot/WebGL behavior. Demonstrate that foreground and background runs enforce the same assertions without skipping checks.

### 4. Richer personality instructions

Expand the core persona, character card and all sixteen personality cards with values, curiosity, measured humor/emotion, relationship stance and speaking habits. Describe work and companionship differences with brief examples. Natural memory references must retain provenance; mistakes must be acknowledged directly. Exclude generic AI disclaimers, flattery, emoji clutter and customer-service filler. Honesty and permission boundaries remain mandatory. Prompt bodies may be Chinese; surrounding repository documentation and code remain English. Automatic checks verify assembly; real-model evaluation requires separate authorization.

### 5. Remove character-to-text connectors

Remove bubble/label connecting lines, guide lines and arrows in the character stages, app and stylesheet. Capture before/after screenshots and inspect the resulting interface.

### 6. Visual memory and relationship history

Build on the current memory panel, memory store, journal and work records. Show preference/project/people cards and a relationship timeline using only stored evidence, with source and date per entry. Derive first meeting, elapsed days, conversations, completed work and milestones only when the underlying records support them; missing history stays unknown. Support correction and genuine deletion. Keep data local and do not invent intimacy scores.

### 7. Continuous voice in the text conversation

Add an explicit microphone control to the composer. Use lightweight energy-based voice activity detection to submit completed utterances to Anna's current brain automatically, preserving memory, tools and permissions. Stream speech by sentence while retaining next-sentence prefetch. Enable echo cancellation and interrupt playback when the user begins speaking. Drive listening, thinking, speaking and mouth movement from actual events. Display microphone capture clearly and fully release devices on shutdown. Verify system microphone authorization on both target platforms and measure end-of-utterance-to-first-audio latency. Agree on background listening scope before implementing it; there is no blanket product ban on future wake-word or background-listening work.

### 8. Agent installation guidance and optional managed installation

Provide plain-language macOS and Windows guidance for every catalogued agent. For Claude Code and Codex, implement on-demand download of the current platform's official npm package, SHA-512 verification, npmmirror first with official-registry fallback, and installation inside Anna's data directory. Use separate `CLAUDE_CONFIG_DIR` and `CODEX_HOME` plus provider setup instead of claude.ai login. Do not bundle those CLIs: retain runtime staging exclusions and add package verification. Resolve Windows Git Bash requirements with the owner. Hide install buttons that have not passed real-machine acceptance before release; guidance can ship independently. Cherry Studio is a possible implementation reference, subject to source/license review.

## Validation and evidence

Every change receives a dedicated bug-finding pass, appropriate failing tests before implementation, local `pnpm preflight`, and independent Standards and Spec reviews. Record findings, fixes, accepted limitations and verification in the PR and `docs/reviews/`. Desktop-flow changes also require `pnpm build` and `pnpm test:scripted`; inspect UI changes visually. Use fake models for automation. Real model/API calls and keys require the owner's explicit authorization; the owner enters keys.

Keep CI and Release manual. Run necessary hosted acceptance once on a stable locally reviewed candidate; investigate the first causal failure before another full run. Bind results to the candidate SHA and target platform. Passing synthetic tests proves the specified engineering behavior, not real microphone quality, model quality or performance on another OS.

The 72-run model comparison and human blind review remain paused. Existing benchmark tooling, synthetic counter fixtures and earlier functional acceptance do not establish token savings or improved answer quality. Resume the comparison only when explicitly requested, with separate baseline/candidate sources, complete measured usage and blinded votes. Preserve private raw evidence outside tracked source.

## Later possibilities

MCP/skills synchronization, additional routing conversions, isolated-worktree delegation, richer portrait artwork and an English UI require their own scoped decisions. They do not displace the ordered work above. Online-demo records describe that edition and its historical build; they do not prove current desktop or deployment acceptance.
