# Pre-push hook from a linked worktree (2026-11-07)

Branch `fix/pre-push-worktree-env`, base `main` at `59c710b`.

## Incident

On 2026-11-07, PR #63 was pushed from a linked worktree. The pre-push hook's validation committed `fixture` and `示例项目` demo commits onto the branch being pushed. It also wrote `core.bare = true` into the shared `/Users/mayuanyuan/git/anna/.git/config`. The repository was recovered by hand: `git reset --mixed` back to the reviewed commit, and `core.bare` set to `false`.

## Cause

Git exports `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_PREFIX` and related variables to hooks. In the main checkout, `GIT_DIR` is the relative path `.git`, so a test that runs `git init` in a temp dir resolves it inside that temp dir, and nothing breaks. In a linked worktree, `GIT_DIR` is an absolute path such as `.git/worktrees/<name>`. `scripts/pre-push.mjs` passed its whole environment to `scripts/preflight.mjs`, so every test fixture that ran `git init` or `git commit` acted on the real repository. One example is `tests/pre-push.test.ts` itself.

## Fix

`scripts/pre-push.mjs` now starts preflight without the repository-local variables that `git rev-parse --local-env-vars` lists. That list covers `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_PREFIX`, `GIT_OBJECT_DIRECTORY`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT` and the rest. Git clears the same set when it moves into another repository. The hook's own checks (`rev-parse HEAD`, `status --porcelain`, before and after validation) still use the original environment, so they still examine the repository being pushed. Names are compared in upper case, because Windows environment keys are case-insensitive.

## Findings

| Severity | Finding | Resolution |
| --- | --- | --- |
| Blocker (the incident) | Preflight inherited the hook's absolute `GIT_DIR`, so fixtures committed into the pushed branch and set `core.bare=true`. | Fixed. |
| Minor (Standards) | The first version dropped every `GIT_*` variable. That also removed user settings such as `GIT_AUTHOR_*`, `GIT_CONFIG_GLOBAL` and `GIT_SSH_COMMAND`, so preflight could behave differently in the hook than when run directly. | Fixed. Now only `--local-env-vars` is dropped, and a test checks that `GIT_AUTHOR_NAME` is kept. |
| Minor (Standards) | The test proved that preflight sees no `GIT_DIR`, but not that the hook's own checks still use it. | Fixed. The test runs the hook from an unrelated repository with `GIT_DIR` pointing at the pushed one. The HEAD check passes only if the hook follows `GIT_DIR`. |
| Minor (Spec, follow-up) | Only the hook is protected. Running `pnpm test` directly inside another git hook (or `git rebase --exec`) would still pass that hook's `GIT_DIR` to the fixtures. | Not fixed here; out of scope. Possible later fix: test helpers that run git, or preflight itself, strip repository-local variables. |
| Nit | The test checks variable names, not values. | Accepted. Any repository-local name showing up fails the test. |

## Verification

- TDD: the new test failed against the old hook. It listed `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE`, `GIT_COMMON_DIR` and `GIT_PREFIX` as visible to preflight. It passes with the fix.
- Mutation check: the old hook fails the new test. A hook that also strips the environment from its own git checks fails it too.
- `pnpm preflight` at `b76c168`: whitespace check, lint, typecheck and tests all pass (96 files passed, 1 skipped; 998 tests passed, 19 skipped). An earlier run timed out at the 20 s limit in `tests/pre-push.test.ts` because two full suites were running at once. Run alone, it passes.
- Old hook, reproduced in a scratch clone with a linked worktree, pushing to a local bare remote. The push failed, the branch tip moved from `e22299a` to a new `fixture` commit `cf867ca`, and the clone's config got `bare = true`.
- Fixed hook, run from a real linked worktree (`git worktree add ../anna-hooktest`, `GIT_DIR=/Users/mayuanyuan/git/anna/.git/worktrees/anna-hooktest`), with a trivial commit pushed to a scratch bare remote rather than origin. The push passed and preflight ran in full. The tip stayed at `78eb107` locally and on the remote. The `.git/config` SHA-1 (`e8a8df3…`) was the same before and after, `core.bare` stayed `false`, and the worktree stayed clean. The scratch worktree and branch were removed afterwards.

## Not verified

- Windows and Linux runs of the hook. The change uses only Node env handling and `git rev-parse`, and no hosted matrix was run, because this is a local developer tool and not a runtime or deployment change.
