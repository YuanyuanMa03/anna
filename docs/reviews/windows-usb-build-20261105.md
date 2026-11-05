# Windows USB candidate build

2026-11-05. The user requested the latest Windows Anna on their USB drive. Source base: `2457cd3` plus the reviewed current-portrait changes in `appearance-naturalness-v1.md`. Target: Windows 11 x64, Core Ultra 5 338H, 32 GB RAM. Destination detected as `/Volumes/HKS`, approximately 7.5 GiB free.

## Build decision and review

The existing Windows packager requires a Windows host. Use one explicit manual invocation of the existing Release workflow on the current feature branch. No release tag, main update, or public release is authorized or needed: the publish job only runs for `refs/tags/v*`, so a branch dispatch produces downloadable artifacts only. Existing macOS/Linux matrix entries are retained.

Add Windows packaged desktop acceptance to that workflow after packaging, using `tests/desktop-launch.mjs` through `pnpm test:scripted`. The Windows installer/uninstaller check is retained. Include the existing ZIP checksum and package report in the Windows artifact. These are the only workflow changes; no automatic trigger is added.

The complete local runtime/test diff was reviewed for speech cancellation, quiet playback, resource cleanup, gaze timing, appearance persistence, and platform behavior in the companion review. Local preflight (707 passed / 19 skipped), production build, and all three desktop flows passed before this build request. The push guard will revalidate the committed candidate without bypasses.

Review: Windows-specific workflow condition and native path are scoped correctly; the package tests use isolated scripted credentials and synthetic media, not the user's models or devices. No new dependency, credential, or model weight is committed. Runtime/model dependencies remain separate. The existing installer preserves `%APPDATA%\Anna`; the portable ZIP is also included for extraction-based use.

## Delivery evidence

Pending the exact candidate's manual run. Copy only the requested Windows deliverables into a new uniquely named directory on the USB drive; preserve existing drive contents. Verify source and destination SHA-256 values and ZIP integrity. The desktop app alone does not include separately downloaded ASR/TTS model weights or a Windows Python speech environment. Actual organizer-machine devices, speech quality, and performance remain unverified until that machine is tested.
