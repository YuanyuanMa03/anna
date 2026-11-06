# Windows USB candidate build

2026-11-05. The user requested the latest Windows Anna on their USB drive. Source base: `2457cd3` plus the reviewed current-portrait changes in `appearance-naturalness-v1.md`. Target: Windows 11 x64, Core Ultra 5 338H, 32 GB RAM. Destination detected as `/Volumes/HKS`, approximately 7.5 GiB free.

## Build decision and review

The existing Windows packager requires a Windows host. Use one explicit manual invocation of the existing Release workflow on the current feature branch. No release tag, main update, or public release is authorized or needed: the publish job only runs for `refs/tags/v*`, so a branch dispatch produces downloadable artifacts only. Existing macOS/Linux matrix entries are retained.

Add Windows packaged desktop acceptance to that workflow after packaging, using `tests/desktop-launch.mjs` through `pnpm test:scripted`. The Windows installer/uninstaller check is retained. Include the existing ZIP checksum and package report in the Windows artifact. These are the only workflow changes; no automatic trigger is added.

The complete local runtime/test diff was reviewed for speech cancellation, quiet playback, resource cleanup, gaze timing, appearance persistence, and platform behavior in the companion review. Local preflight (707 passed / 19 skipped), production build, and all three desktop flows passed before this build request. The push guard will revalidate the committed candidate without bypasses.

Review: Windows-specific workflow condition and native path are scoped correctly; the package tests use isolated scripted credentials and synthetic media, not the user's models or devices. No new dependency, credential, or model weight is committed. Runtime/model dependencies remain separate. The existing installer preserves `%APPDATA%\Anna`; the portable ZIP is also included for extraction-based use.

## Delivery evidence

Candidate `5cb052209c38d04728106bf0c8d4a5806a3aa937` passed [manual build 41996409145](https://github.com/YuanyuanMa03/anna/actions/runs/41996409145). Windows job `127140558519` passed the packaged desktop, onboarding, unconfigured, installer, and uninstaller checks. The macOS and Linux packaging/installer jobs also succeeded; these are not full target-device runtime acceptance. Publish was skipped. No public release was created.

Downloaded Windows artifact `win32-x64`. ZIP CRC verification passed, `Anna.exe` was verified as PE x64, and the archive contains the Anna avatar and ASR WASM. The supplied ZIP SHA-256 matches the downloaded file. All seven delivery files were copied into a fresh `/Volumes/HKS/Anna-Windows-20261105-5cb0522` folder using a temporary directory, flushed, and re-read with SHA-256 matching the local originals. Existing USB contents were preserved.

- `Anna-0.6.0-windows-x64.zip`: 516,952,508 bytes; SHA-256 `5ddea2b2099320463da7d7b2f5c5a1c0a01e6909e3b66abc39ef1aa1f254353a`.
- `Anna-Setup-windows-x64.exe`: 151,557,638 bytes; SHA-256 `0ff73cd6c2239e8f2d9926026e102e45adddc5f95d8011cecf9367bc7d80b628`.
- Also delivered: ZIP's original checksum, `SHA256SUMS.txt`, `package-report.json`, `build-verification.json`, and Chinese usage instructions. The binaries are unsigned. Local evidence remains in ignored `artifacts/windows-usb-*` files.

The desktop app alone does not include separately downloaded ASR/TTS model weights or a Windows Python speech environment; this is explicit in the USB instructions. Actual organizer-machine devices, speech quality, and performance remain unverified until that machine is tested.
