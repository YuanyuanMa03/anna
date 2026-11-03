# Anna development and review rules

## Before changing or pushing

- Inspect the current worktree, branch, relevant code and actual CI logs. Old green runs do not validate new commits.
- Keep changes surgical. Preserve user data, credentials, existing configuration and unrelated work.
- The assistant owns code review: inspect the complete diff against the intended base before pushing, including tests, persistence/migrations, permissions, cancellation, rollback and platform behavior. Record severity, evidence, fixes and verification under `docs/reviews/`. Green tests supplement review; they do not replace it.
- Recheck fixes. State remaining risks and unverified behavior honestly; do not invent approvals from another reviewer/account.
- Install this clone's local push guard with `pnpm hooks:install`. `pnpm preflight` runs whitespace checks, lint, typecheck and unit/integration tests. The pre-push hook rejects dirty worktrees, an unvalidated different branch tip, and failed checks. Do not bypass it to get a green push.
- Changes to desktop flows also require `pnpm build` and `pnpm test:scripted`. Use fake models for automatic checks. Real API acceptance requires task authorization; the 72-run comparison and blind review remain paused until the user resumes them.

## GitHub and branch lifecycle

- Work on one active feature branch; do not push directly to main or force-push shared history.
- Before merging, inspect the current revision's Windows, macOS, Ubuntu and Linux package CI jobs. A prior revision's success is insufficient.
- Keep main, the current feature branch, the online release line and branches referenced by open PRs. Archive obsolete local and remote tips separately before deletion, verify remote archive SHAs, and preserve dirty worktrees. See `docs/branch-archives-20261103.md`.
- Archive tags use `archive/...`, never `v*`. Release tags/deployment require an explicit user request.
- A failed run is evidence to diagnose, not a reason to keep rerunning. Read the first causal failure and reproduce that step before the next full matrix. Retry unchanged code only for a verified transient infrastructure problem.
- Observe an existing live run by its run ID. An observation timeout is not a terminal run. CI concurrency cancels superseded runs on the same ref; release workflows are separate.

## Platform traps

- Use native `path` operations and `os.tmpdir()` in tests. Never assume `/tmp`, forward slashes, missing drive letters, or a Unix executable wrapper on Windows.
- Launch Node/native executables with argument arrays. npm `.cmd` shims require `unwrapCmdShim`; do not concatenate JSON, prompts or paths into shell command text.
- Every Electron acceptance flow must use `tests/desktop-launch.mjs`. It selects the correct packaged executable, cwd, software WebGL and CI source-only Linux sandbox workaround. Packaged Linux uses its own launcher; never disable its sandbox merely to pass tests.
- Wait for completion/enablement, not merely the presence of a button. Keep protocol timeouts bounded and diagnose dead processes/handshakes before increasing them.
- Linux package acceptance must run both before and after AppArmor installation. Folder-dialog return values in the automated flows are mocked: do not describe them as manual native-dialog acceptance.

See `docs/github-actions-lessons.md` for incident evidence and prevention.
