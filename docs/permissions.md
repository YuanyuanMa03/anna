# Permission modes and the sandbox

Anna's permissions are modelled on [Claude Code](https://code.claude.com/docs/en/permissions) and
[Codex](https://learn.chatgpt.com/docs/agent-approvals-security) in three layers:

- **Modes** decide the default. Like a Codex preset, each one pairs what shell commands may touch (the sandbox) with
  when Anna asks (the approval policy).
- **Rules** remember your exceptions, in Claude Code's `Bash(...)`, `Read(...)` and `Edit(...)` format.
- **The OS sandbox** is the real boundary for shell commands.

## Four modes

| | Plan | Ask | Edit | Auto |
|---|---|---|---|---|
| Read files in the workspace | ✓ | ✓ | ✓ | ✓ |
| Read files outside the workspace, `~/.ssh` and `~/.aws` included | ask | ask | ask | ✓ |
| Read secret files such as `.env` or `*.pem` | ask | ask | ask | ask |
| Read or edit Anna's own keys and data | ✗ | ✗ | ✗ | ✗ |
| Edit files in the workspace | ✗ | ask | ✓ | ✓ |
| Edit files outside the workspace | ✗ | ask (risky) | ask (risky) | ask (risky) |
| Read-only commands (`ls`, `cat`, `git status`, `rg`, `cd`) | ✓ | ✓ | ✓ | ✓ |
| Verify commands (tests, lint, builds, `node --test`) | ✗ | ask | ✓ | ✓ |
| Other commands, network commands | ✗ | ask | ask | ✓ (in the sandbox) |
| Risky commands (`rm -rf`, `git push`, `sudo`) | ✗ | ask (risky) | ask (risky) | ask (risky) |
| Network from the sandbox | ✗ | ask per domain | ask per domain | common registries allowed, others ask |
| Codex equivalent | read-only | workspace-write, ask before changes | workspace-write + on-request | workspace-write, no routine prompts |
| On stage | quiet, reading her notes | attentive, brows raised | neutral | leaning in, brisk |

- Press **Shift+Tab** in the input box to switch modes.
- Edit and Auto are only available in **trusted folders**. When you open a new folder, Anna asks whether you trust it.
  Untrusted folders don't load project instructions such as `AGENTS.md`.
- **Tasks from WeChat** always run in Ask mode, whatever the current mode is.
- Without a sandbox, Auto mode still asks before commands that change things. That covers Windows today, and Linux
  when bubblewrap is missing.
- Approvals marked "risky" can only be granted once at a time, never for a session or permanently.
- Credential folders such as `~/.ssh` and `~/.aws` are ordinary paths outside the workspace, as in Claude Code: reads
  ask outside Auto mode, and **Always allow** saves a rule such as `Read(//Users/you/.ssh/**)`. That rule keeps
  working when `~/.ssh` is a symlink.
- Secret files ask in every mode before their contents go to the model. The same check applies whether the read tool
  names the file, a command names it (`cat .env`), or a recursive search would read it (`grep -r SECRET .`,
  `rg -uu`, the grep tool outside a git repository). Searches that skip gitignored or hidden files don't ask.
  **Always allow** remembers that one file (`Read(./.env)`). Listing names (`ls`, `find -name .env`) never asks.
- Only Anna's own data directory (keys, settings, sessions, memory, checkpoints) is unreachable, whatever the mode,
  rule or approval. Both its path and the path it resolves to are checked, so a symlink or a `cd` into the real
  location doesn't get around it.

## Rules

Rules use Claude Code's format and matching. Precedence is deny > ask > allow, whatever the specificity.

```
Bash                       every command
Bash(pnpm test)            this exact command
Bash(pnpm install *)       * matches any text; a trailing " *" also matches "pnpm install"; ":*" works too
Read(~/notes/**)           ~/ is your home folder, // starts an absolute path
Read(/docs/**)             a single / is the workspace root, as in Claude Code
Read(.env)                 a bare name matches at any depth in the workspace
Edit(src/**)               covers write and edit; as an allow rule only <workspace>/src
Network(*.github.com)      sandbox network access
```

Like Claude Code:

- **Compound commands** (`&&`, `||`, `;`, `|`, `&`, newlines) are allowed only when every part is: by a rule, or
  because it is read-only. With `Bash(npm test *)` allowed, `npm test && node -e "…"` still asks. Deny and ask rules
  match any part, including after `timeout`, `nohup`, bare `xargs` or a leading `FOO=bar`.
- **A command Anna can't parse** never matches an allow rule. That covers substitutions (`$(…)`, backticks),
  redirections, subshells, a dangling `&&` and unclosed quotes. Operators inside quotes don't split a command.
- **Symlinks**: a deny or ask rule matches either the path as written or the path it resolves to. An allow rule must
  match both, so `Read(link/**)` doesn't follow a link out of the workspace. The exception is a `//` or `~/` rule,
  which names the path you chose and also covers where it leads.
- A **Read deny** rule also blocks writes to the same path, and applies to the paths a shell command names.

How a rule is saved depends on the button you press:

- **Allow for this session** keeps the rule until the session ends.
- **Always allow** writes the rule to the workspace settings.

Cards offer the rule only when it covers exactly what they showed. That means one rule per part that needed approval
(`Bash(pnpm install *)`), and none for commands Anna can't parse or rules that would grant more, such as `Bash(git *)`.
Every rule can be removed under **Appearance & Capabilities → Permission rules**.

## Sandbox

Shell commands run through [`@anthropic-ai/sandbox-runtime`](https://github.com/anthropics/sandbox-runtime), with
Seatbelt on macOS and bubblewrap on Linux. It works like Claude Code's default sandbox:

- **Writes** are limited to the workspace, temp directories and package manager caches. sandbox-runtime itself protects
  shell profiles such as `.zshrc` and the git config.
- **Reads** cover most of the machine, credential folders included. Anna's data directory is blocked, listed both as
  written and as resolved. Seatbelt checks the resolved path, so a symlinked folder needs both entries.
- **Network** is denied by default. Every domain goes through Anna's approval card. Auto mode allows npm, PyPI,
  crates.io, the Go proxy and GitHub automatically.

At startup Anna runs `true` inside the sandbox as a self-test. If that fails, she falls back to "no sandbox" and shows
the reason in the UI.

## Delegated agents

Claude Code runs with Anna's mode mapped to its own (`plan`, `default`, `acceptEdits`). It gets `Read` and `Edit` deny
rules for Anna's data directory, and its permission prompts land on Anna's cards. Codex gets the sandbox and approval
pair from the table above.

## Known limits

- pi's read and write tools run inside the core process, not in the OS sandbox, so only the policy engine guards them.
  The engine resolves paths exactly like pi and follows symlinks.
- The secret-file check reads what Anna can see: file names on the command line and a bounded walk of the folders a
  search covers. A program that opens files itself (`node`, `python`, a test run) isn't covered, the same limit
  Claude Code documents for its Read rules.
- Undo covers changes made by Anna's file tools (write and edit), not changes made by commands. Claude Code's
  checkpoints have the same limit.
- Command classes only reduce prompts; they are not a security boundary. Without a sandbox, trust only your own projects.
- Anna's data directory is hidden from delegated agents only where the agent supports it. Claude Code gets deny rules
  through `--settings`. Codex's sandbox has no way to deny reads (its policies only limit writes), and Gemini CLI,
  OpenCode and Pi have none either, so those agents can read Anna's data while they work. Delegate to them only in
  folders you trust.
