# Permission modes and the sandbox

Anna's permissions follow Claude Code's design in three layers:

- **Modes** decide the default.
- **Rules** remember your exceptions.
- **The OS sandbox** is the real boundary.

## Four modes

| | Plan | Ask | Edit | Auto |
|---|---|---|---|---|
| Read files in the workspace | ✓ | ✓ | ✓ | ✓ |
| Read files outside the workspace | ask | ask | ask | ✓ |
| Read secrets such as `.env` or `*.pem` | ask (risky) | ask (risky) | ask (risky) | ask (risky) |
| Read `~/.ssh`, `~/.aws`, keychains, Anna's own data | ✗ | ✗ | ✗ | ✗ |
| Edit files in the workspace | ✗ | ask | ✓ | ✓ |
| Edit files outside the workspace | ✗ | ask (risky) | ask (risky) | ask (risky) |
| Inspect commands (`ls`, `git status`, `rg`) | ✓ | ✓ | ✓ | ✓ |
| Verify commands (tests, lint, builds) | ✗ | ask | ✓ | ✓ |
| Other commands, network commands | ✗ | ask | ask | ✓ (in the sandbox) |
| Risky commands (`rm -rf`, `git push`, `sudo`) | ✗ | ask (risky) | ask (risky) | ask (risky) |
| Network from the sandbox | ✗ | ask per domain | ask per domain | common registries allowed, others ask |
| On stage | quiet, reading her notes | attentive, brows raised | neutral | leaning in, brisk |

- Press **Shift+Tab** in the input box to switch modes.
- Edit and Auto are only available in **trusted folders**. When you open a new folder, Anna asks whether you trust it.
  Untrusted folders don't load project instructions such as `AGENTS.md`.
- **Tasks from WeChat** always run in Ask mode, whatever the current mode is.
- Without a sandbox, Auto mode still asks before commands that change things. That covers Windows today, and Linux
  when bubblewrap is missing.
- Approvals marked "risky" can only be granted once at a time, never for a session or permanently.

## Rules

Rules use the Claude Code format. Precedence is deny > ask > allow.

```
Bash(pnpm test)            this exact command
Bash(pnpm install:*)       commands starting with this
Read(~/notes/**)           path glob; relative to the workspace; // starts an absolute path
Edit(src/**)               covers write and edit
Network(*.github.com)      sandbox network access
```

How a rule is saved depends on the button you press:

- **Allow for this session** keeps the rule until the session ends.
- **Always allow** writes the rule to the workspace settings.

Every rule can be removed under **Appearance & Capabilities → Permission rules**.

## Sandbox

Shell commands run through [`@anthropic-ai/sandbox-runtime`](https://github.com/anthropics/sandbox-runtime), with
Seatbelt on macOS and bubblewrap on Linux:

- **Writes** are limited to the workspace, temp directories and package manager caches. sandbox-runtime itself protects
  shell profiles such as `.zshrc` and the git config.
- **Reads** of credential folders and Anna's data directory are blocked.
- **Network** is denied by default. Every domain goes through Anna's approval card. Auto mode allows npm, PyPI,
  crates.io, the Go proxy and GitHub automatically.

At startup Anna runs `true` inside the sandbox as a self-test. If that fails, she falls back to "no sandbox" and shows
the reason in the UI.

## Known limits

- pi's read and write tools run inside the core process, not in the OS sandbox, so only the policy engine guards them.
  The engine resolves paths exactly like pi and follows symlinks.
- Undo covers changes made by Anna's file tools (write and edit), not changes made by commands. Claude Code's
  checkpoints have the same limit.
- Command classes only reduce prompts; they are not a security boundary. Without a sandbox, trust only your own projects.
