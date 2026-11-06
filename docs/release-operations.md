# Release and operations

This guide describes the 1.0 candidate, not a published 1.0 release. Start with [architecture](architecture.md) and [the iteration roadmap](roadmap.md). Detailed evidence remains in [the Windows review](reviews/v1.0-windows.md); branch archives and CI incidents remain in their dated records.

## Candidate and evidence

As checked on 2026-11-06, PR [#51](https://github.com/YuanyuanMa03/anna/pull/51) is the draft `release/v1.0` candidate; PR [#52](https://github.com/YuanyuanMa03/anna/pull/52) targets that branch with graphics logging and Windows script-launch fixes. Neither is merged. The owner subsequently reported that Windows retesting was acceptable and asked development to proceed. No new per-scenario logs were supplied, so this does not independently establish that DEP0190, detection, installation and delegation each passed.

The existing #52 installer is 138,091,790 bytes, SHA-256 `0c858525304ad84ba5b6ebbfd116a4510e992c5f3c465017cb32a1b5c3d1c503`. Static Windows package verification was repeated on macOS for that candidate: 633 installed files, longest relative path 122 characters. Static verification does not establish Windows execution. Recheck refs and artifacts before a later release.

## Development loop

Install dependencies with the pinned package manager and runtime, then enable this clone's push guard:

```sh
pnpm install --frozen-lockfile
pnpm hooks:install
pnpm preflight
```

Use a separate feature branch and draft PR for each work item. Find bugs before declaring it ready. Review the entire diff against the intended base, fix findings, and record two independent reviews (Standards and Spec) plus verification in `docs/reviews/` and the PR description. Write a failing behavior test before implementation when changing behavior; documentation changes need link checks and local lint/review. Do not add tests that merely repeat prose.

Desktop behavior changes also require `pnpm build` and `pnpm test:scripted`; inspect UI changes visually. All automated Electron starts use `tests/desktop-launch.mjs`. Automated models, devices and speech replies are fake or synthetic. These checks establish the exercised engineering behavior, not real-model quality or real-device acceptance. Real API calls and real keys need explicit authorization; the owner enters keys. The 72-run comparison and blind review remain paused.

CI is manual-only. Run local checks first, then batch necessary hosted acceptance once on a stable candidate when target machines are unavailable. Observe existing runs by ID, diagnose the first causal failure, and reproduce it before another full matrix. Do not rerun unchanged code without evidence of transient infrastructure failure. Release additionally runs on explicit `v*` tags; that trigger is not permission to create one.

## Installation and first launch

Windows 1.0 has no code-signing certificate. The preferred installation entry is PowerShell:

```powershell
irm https://anna.mayuanyuan.top/install.ps1 | iex
```

The current script fetches `latest.json`, selects the architecture, downloads the ZIP, checks its SHA-256, installs into `%LOCALAPPDATA%\Programs\Anna`, applies `Unblock-File`, and creates a Start-menu shortcut. It stops Anna before replacing the installation directory. It does not delete `%APPDATA%\Anna`. The script checks the download hash; it does not currently verify the manifest's Ed25519 signature. The in-app updater does verify that signature. End-to-end installation with this script is still pending acceptance; do not advertise it as tested.

For the unsigned EXE, explain SmartScreen's **More info → Run anyway** flow. Browser download reputation prompts can also appear. Provide screenshots from the target system when preparing the final website instructions; no screenshots have been captured by this documentation change.

The owner confirmed on 2026-11-06 that Developer ID is not yet available; prepare the locally signed release path and opening instructions. macOS currently uses local signing, without notarization. For the DMG, drag Anna to Applications; if blocked, use **System Settings → Privacy & Security → Open Anyway**. The website and README need actual screenshots of this flow before the release instructions are considered complete. Do not promise that every unsigned download avoids system prompts.

If the owner obtains a Developer ID certificate and stores notarization credentials in Keychain, confirm that change with the owner before implementing formal signing/notarization. Test an upgrade from the old locally signed build, recording microphone/folder authorization and access to **Anna Safe Storage**. Preserve the app name, bundle identity and user data. Local signing alone does not prove permission retention: a changed code hash can cause a new Keychain prompt. Never weaken Keychain ACLs or copy device-bound encrypted credentials to another machine to pass acceptance.

## Acceptance before release

On clean macOS and Windows machines, exercise the exact candidate through website download, install, first start, configuration, conversation, voice, full quit/reopen and an in-app update to a newer version. Record candidate SHA, package hashes, OS/architecture, commands/actions, results and artifacts under `docs/reviews/`. Agree Windows testing times with the owner. The earlier user-reported retest does not replace this clean-install/update sequence.

Check startup through `logs/anna.log` under the platform data directory: both `core ready` and `window loaded` should appear. Verify the graphics line against actual rendering and check for DEP0190 while detecting, installing and delegating to agents. Keep logs local unless inspected for private content; do not collect keys, sessions or memories as generic diagnostics.

Speech acceptance must exercise actual microphone authorization, capture, release, playback and mouth motion on both target systems. MiMo synthesis previously varied from 4.6 to 38.6 seconds; measure speech-end to playback-start latency rather than assuming the previous samples predict the venue. Real 24 kHz audio playback, lip motion and prefetch timing need hardware evidence. Agree the scope of any background microphone capture with the owner before implementing it.

Test denial, cancellation, failed connectivity and recovery as appropriate to each changed flow. A mocked folder dialog or speech reply is not native-device acceptance. If acceptance fails and passing would require shrinking the agreed scope, ask the owner instead of silently removing checks.

## Packaging

```sh
pnpm package:mac
pnpm package:dmg
pnpm package:windows
pnpm package:windows-installer
pnpm verify:package windows
pnpm smoke:package
```

`package:mac` requires macOS arm64. Windows packaging can run on macOS or Windows; NSIS (`makensis`) is required for the installer. Packages stage a link-free runtime closure in `app.asar`, unpack native files, and ship checksum-pinned `rg`/`fd`. Preserve dependency licenses. `verify:package` checks layout, architecture, dependencies and paths; `smoke:package` runs the current platform's bundled tools and startup. A macOS smoke result does not validate a Windows installer. Test the source and packaged desktop flows separately when runtime changes.

## Local model service

The optional service in `scripts/local-speech/` runs separately from the desktop package and has no New API dependency. It binds only to loopback and does not capture or play audio. Install on the machine that will run the local models, using a separate Python environment. Python 3.12 is a suitable target for the pinned requirements; availability of native wheels must be checked on the target OS/architecture.

```sh
python3.12 -m venv .venv-voice
# Windows: use .venv-voice\Scripts\python.exe for the following Python commands.
.venv-voice/bin/python -m pip install -r scripts/local-speech/requirements.txt
.venv-voice/bin/python scripts/local-speech/server.py --model-dir "/path/to/kokoro" --asr-model "/path/to/offline-paraformer/model.int8.onnx" --asr-tokens "/path/to/offline-paraformer/tokens.txt"
```

Supply an offline Paraformer model supported by sherpa-onnx; the former streaming Sherpaw `preload.data` package is a different format and cannot be passed as this ONNX model. Model acquisition/licensing and native inference must be verified separately. The service does not download models. Kokoro expects the files described by `load_model` in `server.py`, including its lexicons, token file, voices and rule FSTs. Upstream references: [Kokoro](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html), [offline recognition API example](https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/offline-decode-files.py).

Configure both local speech addresses as `http://127.0.0.1:17861/v1`, recognition model `paraformer-local`, synthesis model `kokoro-local`, voice `anna`, and explicitly empty keys. `--asr-model` and `--asr-tokens` are optional together; omitting both starts TTS only, and recognition returns an explicit 503. The service serializes model work, rejects overlap with 429, and keeps health/model listing available. Ctrl+C stops it. Desktop startup does not start this service.

Run the local protocol checks after installing the optional requirements with `python scripts/local-speech/test_server.py`. To exercise real local models through the desktop, start the local ASR/TTS service, build the app, then run `ANNA_LOCAL_VOICE_ACCEPT=1 node tests/accept-local-voice.mjs` (PowerShell: set `$env:ANNA_LOCAL_VOICE_ACCEPT="1"` first). Override `ANNA_LOCAL_VOICE_URL` for a different loopback port. The acceptance synthesizes a reference phrase and checks the returned transcript; its report is `artifacts/local-voice-acceptance.json`. This is a functional round trip, not an accuracy benchmark.

## Linux support

Linux code, existing packaging, installer and acceptance coverage are retained. The immediate 1.0 experience priority is macOS and Windows; this documentation consolidation does not disable Linux or change its behavior. Dedicated Linux packaging design prose is retired. Existing platform requirements in `AGENTS.md`, including acceptance before/after AppArmor installation for Linux runtime changes, remain applicable. Use the maintained scripts and [CI incident record](github-actions-lessons.md) for implementation evidence.

## Authorized release sequence

Every merge, push to a long-lived branch, release tag, publication and deployment requires a separate explicit approval in the conversation. A test pass, draft PR, earlier approval or this runbook is not approval for the next action. Feature-branch preparation and draft PR review may proceed under the development request.

1. Review and validate the exact candidate, then request approval for the specific merge. Keep #52's dependency on #51's release branch visible.
2. Prepare the version change and obtain approval before merging or pushing the long-lived release line. `package.json` already says `1.0.0`; verify the final candidate instead of incrementing it blindly.
3. With explicit tag authorization, create the intended `vX.Y.Z` tag. The Release workflow builds packages and creates a **draft** Release for tags; a branch dispatch builds artifacts without publishing a release.
4. Build/sign the macOS package locally using the agreed identity and complete upgrade acceptance. Obtain approval before replacing the draft Release's Mac ZIP/DMG assets. Check their final hashes.
5. After approval, regenerate `latest.json` from the final assets and sign it locally with `scripts/sign-manifest.mjs`. The signing key stays outside the repository. The manifest includes version, release notes, asset URLs and SHA-256 values; retain one asset per line for the shell installer. Replacing a package after signing requires regenerating its hash and signing again.
6. Obtain explicit approval before publishing the draft Release and making it Latest, and separately before deploying the website containing the signed manifest. Verify the published downloads and updater against those final bytes.

`release-manifest.mjs` writes the manifest using the version from `package.json`; `sign-manifest.mjs` reads `ANNA_RELEASE_SIGNING_KEY` or the existing local release-key path. These describe the tooling, not permission to access keys or publish. Preserve the existing release public key unless a separately approved migration is required: versions through 0.5.1 need manual upgrade to the release-key line introduced in 0.6.0.

## Recovery and records

Keep `main`, the active feature branch, the online release line and branches referenced by open PRs. Archive obsolete local and remote tips separately, verify remote archive SHAs, and preserve dirty worktrees before deletion. Use `archive/...` tags, never `v*`; see [branch archives](branch-archives-20261103.md).

User data lives in `~/Library/Application Support/Anna`, `%APPDATA%\Anna`, or `$XDG_DATA_HOME/anna`. Credentials are encrypted through the platform vault; Linux without a keyring has an explicitly labelled private-file fallback. Damaged supported JSON stores are quarantined rather than overwritten; an undecryptable credential file is left in place and asks for configuration again. Back up user data before manual recovery, keep private artifacts out of public source history, and never treat moving encrypted credential files between devices as a credential migration.
