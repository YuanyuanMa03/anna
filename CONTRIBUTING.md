# Contributing to Anna

Thanks for helping! Anna is young, so issues that describe what you tried and what happened are as valuable as code.

## Set up

```bash
pnpm install --frozen-lockfile
pnpm hooks:install     # install this clone's pre-push checks
pnpm assets            # Live2D models, not in Git
pnpm dev:desktop
```

You only need pnpm. It switches itself to the pinned 10.33.0 (`packageManager`) and downloads the pinned Node 24.21.0, the version inside Electron 44 (`devEngines.runtime`, also in `.nvmrc`), so every machine builds with the same tools. On Linux, install `bubblewrap`, `socat` and `ripgrep` for the command sandbox.

## Before you open a pull request

```bash
pnpm preflight
pnpm build && pnpm test:scripted
```

`test:scripted` drives the real desktop app with a scripted model, so it needs no API key. CI runs the same checks on
macOS, Windows and Linux.

## Guidelines

- **Security first.** Anything that touches `packages/permissions`, the sandbox, the vault or the gate needs a
  regression test that tries the bypass. Read [docs/architecture.md#permission-policy](docs/architecture.md#permission-policy) first.
- **Test at the public seams.** That means the policy engine's `decide()`, the Host commands, the agent decoders with
  recorded fixtures, and the scripted desktop run. Avoid tests that mock internals.
- **New agents.** Follow [adding an agent](docs/architecture.md#adding-an-agent). Record fixtures with
  `scripts/record-agent.mjs`, which strips personal details.
- **Shell scripts.** Brace variables that are followed by text (`${VAR}`), and keep user-facing messages in English.
  A test checks this.
- **Commits.** Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:` and so on)
  and keep each one focused.

## Live2D assets

The sample characters are Live2D's and are not covered by Anna's license. Don't commit model files. If you contribute a new
character, include its license and make sure redistribution is allowed.

## License of contributions

Anna is free for noncommercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE), and the author also
sells commercial licenses ([COMMERCIAL.md](COMMERCIAL.md)). By opening a pull request, you agree that your contribution
may be distributed under both: the PolyForm Noncommercial license and commercial licenses granted by the author.

## Review and GitHub lessons

Read [AGENTS.md](AGENTS.md) for the assistant review contract and [GitHub / Actions lessons](docs/github-actions-lessons.md) for known platform traps. Review findings and validation go in `docs/reviews/`. Git hooks run mechanical checks; they do not replace semantic review. Each new clone must install its hook.

Keep the current commit's cross-platform CI green before merging. [Archived branch tips](docs/branch-archives-20261103.md) remain recoverable. Archive tags never use the release `v*` prefix. Real model comparisons and blind review remain paused until the user resumes them.
