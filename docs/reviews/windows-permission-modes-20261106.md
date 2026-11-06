# Windows permission modes review

Date: 2026-11-06. Branch: `codex/windows-permission-modes`; intended base: `codex/v1-docs` at `3f3fd62c0507c87c198b7c8fc9ae3937acad5ac6`. Stacked after documentation draft PR #53. No merge or release is authorized by this record.

## Behavior and source

The owner requested Windows modes without an OS command sandbox while retaining the macOS sandbox design. The [Claude Code permission documentation](https://code.claude.com/docs/en/permissions) was read on 2026-11-06: `bypassPermissions` removes routine approval, while permission rules and sandboxing are separate mechanisms. Anna keeps its requested application-level floors rather than claiming Windows OS isolation.

- Complete the requested PowerShell high-risk classes and aliases/parameter abbreviations, read-only commands/property pipelines, cmd slash switches, and platform-selected path resolution/containment. Windows realpath still follows native links/junctions; synthetic Windows paths can be tested on a Mac.
- Windows Auto requires a trusted folder and explicit first-use confirmation. Save acknowledgement in settings; absence on upgrade clamps old Auto to Ask. Appearance & Capabilities can revoke it, switch saved Auto workspaces to Ask, and require confirmation again. Remote channels remain Ask.
- Normal Windows Auto commands run directly; high risk, outside-workspace modification and secret reads require one-time confirmation, even under saved allow rules. Anna-gated access to its data remains denied. Plan remains read-only; Ask confirms changes; Edit permits explicit workspace file operations and verification while other executors/network commands ask.
- Descriptions, mode greetings, initial instructions and capability text describe actual sandbox availability. macOS sandbox startup/mapping is unchanged; macOS/Linux without a sandbox keep the previous conservative Auto command behavior.
- Compound approval cards list every safe subcommand rule. Broker, card and Host share a complete-set normalizer; incomplete/empty rule sets, dangerous calls and memory confirmations cannot widen permission. Session/permanent approval remembers the displayed complete set; the legacy single-rule field remains supported.

## Bug-finding and independent reviews

A dedicated bug-finding pass preceded final verification. Two fresh independent sub-agents then reviewed the entire feature diff for Standards and Spec; they were distinct from the implementation agents. They rechecked fixes and reported no remaining blockers.

| Severity | Evidence | Resolution and verification |
|---|---|---|
| P1 | `Get-Content -Path:.env`, colon-bound protected paths and `Set-Content -Path:C:\outside\x.txt` bypassed path analysis | Extract Windows colon-bound parameter values, including abbreviated and quoted bindings; new Path/LiteralPath/Pa/Li regression failed first, then passed. |
| P1 | PowerShell comma arrays were treated as one bogus filename, bypassing secret, outside-write and protected-data checks | Split literal array elements outside quotes before path checks; keep quoted commas intact. Original failing probes now ask/deny as appropriate. |
| P1 | `Get-ChildItem -Force | Get-Content` and wildcard content reads bypassed secret confirmation | Content-reader wildcards and enumeration-to-content pipelines require one-time approval. Enumeration roots covering protected data deny. Pure metadata pipelines still allow. New regressions failed first and both reviewers rechecked the fixes. |
| P2 | A consent save failure left the new mode active; overlapping workspace changes could roll back into the wrong folder | Restore previous settings on save failure, capture a stable workspace path, and serialize mode/revocation with workspace reconfiguration. Failure and concurrency regressions failed before fixes, then passed. |
| P2 | Capability text claimed remembered secret access in Windows Plan/Ask/Edit | State recurring secret approval for every Windows mode, matching engine behavior. Spec rechecked. |
| Bug-finding | `findstr /s` could read hidden/ignored secret files; `/g:.env` pattern input was skipped | Add bounded file/glob search scope, handle pattern/list input paths, and test synthetic hidden/ignored files without executing findstr. Seven scanner tests failed six cases first, then passed. |
| Bug-finding | Windows `$HOME\...`, cwd changes and no-argument executors could miss named protected/outside paths | Normalize Windows HOME spellings, track cwd, and apply outside-write checks to the effective cwd as well as explicit arguments. Dedicated regressions pass. |
| Verification | Old permission tests fed native Windows file paths to hardcoded macOS semantics | Use native platform paths and Windows junctions for real filesystem fixtures; explicitly assert the new Windows differences without weakening the macOS checks. Synthetic Windows drive/UNC tests run on every host. |

## Verification

All command text and filesystem inputs in new policy tests are explicitly synthetic. No dangerous command, package installation, real key or model API is executed by those tests.

- Tests first: command/path suite initially had 94 failures; initial engine tests had 9 failing groups; three new compound-broker cases failed; initial consent/upgrade tests failed. Later binding, array/glob, persistence and race regressions were each reproduced before fixing.
- `pnpm preflight`: passed lint, renderer/Host typechecking and 934 tests, 19 skipped (88 test files passed, one skipped).
- Two additional Host integration cases subsequently passed, verifying complete compound-rule session persistence, permanent persistence in settings, and a repeated call without another prompt. The mandatory pre-push guard validates the final committed tip again.
- `pnpm build`: passed; existing large-renderer-chunk advisory remains. `pnpm test:scripted`: all desktop, onboarding, unconfigured and startup-failure flows passed on macOS arm64 using fake models. Every Electron flow uses `tests/desktop-launch.mjs`.
- Two independent reviewers reran relevant policy/consent/broker tests and original reported probes after fixes; no remaining Standards/Spec blockers. `git diff --check` passed.
- Visually inspected actual source desktop output and a browser preview using the real Vue mode/approval components with synthetic Windows props. Confirm cancellation leaves Edit/unacknowledged state, explicit confirmation sets Auto/acknowledged state, and both compound rules are visible. Local screenshots: `output/playwright/windows-auto-confirm.png`, `output/playwright/windows-compound-rules.png`, `artifacts/scripted-mode-ask.png`. Screenshots containing private character art remain ignored local artifacts.

## Remaining limits and target acceptance

Windows native execution and the new confirmation/revocation flow have not run on Windows for this candidate. The scripted test now exercises the Windows confirmation when running there; a macOS run does not cover that conditional. A stable candidate still needs the applicable target-platform acceptance before merge. No hosted workflow was dispatched for routine development.

Windows Auto runs with the user's OS permissions. The policy checks supported literal paths, aliases, command syntax and permission requests; arbitrary programs can compute paths or open files internally. `/f:` file lists can indirectly name files beyond the statically known scope. PowerShell scriptblocks and unsupported constructs remain conservative in Plan/Edit; Auto remains an explicitly acknowledged bypass. This change is not an OS sandbox or a proof that all indirect access is intercepted.

External agents only send some native tool actions through Anna's gate. Their auto-approved operations may not be intercepted; Codex and other agents retain the data-read limits already described in architecture. The PR does not broaden their launch permissions or claim to solve these existing protocol limitations.

No user credentials/data are migrated or deleted. Consent is additive and absent by default; removing it restores the stricter Windows behavior. Reverting this feature restores the earlier policy and ignores the extra settings field. Revocation cannot undo a command that already ran. Linux code, packaging and workflows remain intact. No long-lived branch was pushed, no merge/tag/publication/deployment was performed, and no real-model evaluation was started.
