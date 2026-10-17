# Spec: external agents and unsigned distribution

> Status: implemented (2026-10-17). This document is the source of truth; change it before changing the behavior.
>
> Where the implementation differs from the spec:
> - Running a delegation in its own git worktree is not implemented yet. Delegations in the same workspace run one after
>   another.
> - The Gemini CLI, OpenCode and Pi adapters follow the official protocols and source code but haven't been recorded on
>   a real machine. The UI marks them "not verified on a real machine". Claude Code and Codex are verified on a real
>   machine for delegation, approvals and the brain swap.
> - When Claude Code or Codex is Anna's brain, Anna's own tools (memory, status, delegation) aren't available. Her
>   persona, permission mode and memory notes are injected into their system prompt.

## 1. External agents

### 1.1 Roles
- **Delegation first.** pi stays Anna's brain, and external agents are colleagues she can dispatch.
- **Brain swap last.** It reuses the delegation adapters. Settings let you pick Anna's brain: pi, Claude Code or Codex.

### 1.2 Detection (following cc-switch)
- Detect every app cc-switch supports: Claude Code, Claude Desktop, Codex, Gemini CLI, Grok Build, OpenCode, OpenClaw,
  Hermes, Pi and MiniMax Code.
- Search beyond `PATH`, because a GUI app doesn't inherit the terminal's `PATH`:
  - `~/.local/bin` and Homebrew;
  - npm, pnpm and bun global folders;
  - the Node folders of nvm, fnm, volta and mise.
- Report for each agent:
  - whether it's installed, its path and version (`--version`);
  - whether it's logged in, by running only its own status command and never reading credential files;
  - its config folder and capability tier.
- Two capability tiers:
  - **Delegate + switch provider**: Claude Code, Codex, Gemini CLI, OpenCode, Pi.
  - **Detect + switch provider only**: Claude Desktop, Grok Build, OpenClaw, Hermes, MiniMax Code.
- Offer install and upgrade commands, the same ones cc-switch uses (`npm i -g <package>@latest` or the official install
  script). The user confirms before they run.

### 1.3 Integration
- Use the headless protocol of the CLI the user already installed; don't bundle SDKs.
  - **Claude Code:** `claude -p --output-format stream-json --verbose`.
    - Resume with `--resume`.
    - Map the mode with `--permission-mode`.
    - Route approvals to Anna through `--permission-prompt-tool`.
  - **Codex:** `codex exec --json`, preferring `app-server` when it's available.
    - Resume with `resume`.
    - Set the sandbox with `-s`.
  - **Gemini CLI, OpenCode and Pi:** each one's headless JSON stream.
- An adapter does two things only: call Anna's permission gate, and normalize events into `KernelEvent`s.

### 1.4 Providers
- Anna keeps her own provider library. Presets are reused from cc-switch (MIT, with attribution), plus a sync script.
- **Per delegation (default).** The provider is injected only through the child process's environment or `-c` flags.
  No file is touched.
- **Apply globally.** Writes the CLI's config following cc-switch's rules:
  - change only the connection fields and keep the original format;
  - back up the original file before the first write;
  - re-read and compare after writing;
  - never write a file Anna can't parse.

  The original config can be restored in one click.
- When cc-switch is installed, import its providers read-only, and warn the user not to switch from both apps at once.
- Neither Anna's brain nor any delegated agent can read or write `~/.claude`, `~/.codex` and similar folders. Only the
  Host writes them.

### 1.5 Delegation
- **Who starts it:**
  - The user can mention an agent: `@claude …`, `@codex/glm …`.
  - Anna can delegate herself through the `anna_delegate(agent, task)` tool. In Plan and Ask she asks first; in Edit and
    Auto she goes ahead.
- **Permissions:**
  - Anna's mode maps to the agent's native settings (see `permissions/modes.ts`).
  - The agent's approval requests become Anna's approval cards.
  - Tasks from WeChat run in Ask mode.
- **Scheduling:** one external agent runs per workspace at a time; the rest queue. A git repository can optionally run it
  in a separate worktree.
- **Snapshots:** before each delegation the workspace is snapshotted: `git stash create` for git repositories, and
  copies of the changed files otherwise. The delivery card offers diff and undo.
- **Sessions:** each agent's session id is recorded, so talking to the same agent again resumes its session. In the
  transcript, each delegation shows as a collapsible block, and there's a browser for delegation sessions.
- **Live2D:**
  - Anna switches to a "supervising" pose.
  - The stage shows a collaborator card with the agent, provider and current step.
  - Anna relays the result in her own words.

## 2. Distribution without an Apple developer account

- **Signing identity.** Every build is signed with a self-signed code-signing certificate, "Anna Local Signing". This
  keeps folder permissions across updates. It does not keep Keychain access: without an Apple team ID, macOS
  partitions the safeStorage entry by each build's cdhash, so a new build asks for the login password once.
- **Install:**
  - macOS: `curl -fsSL …/install.sh | bash` installs to `~/Applications`. Files downloaded by curl carry no quarantine
    flag, so Gatekeeper shows no prompt.
  - Windows: `irm …/install.ps1 | iex` installs to `%LOCALAPPDATA%\Programs\Anna`.
  - Linux: `install.sh` installs to `~/.local/share/anna-app` and adds a desktop entry.
- **In-app updates.** Download the new version, verify its SHA-256, swap it in and restart.
- **Secrets.**
  - All secrets are merged into one encrypted record, read once at startup and then kept in memory.
  - On Linux without a system keyring, they fall back to a 0600 file, and the UI says so.

## 3. Out of scope this round
- MCP and skills sync, and usage statistics: next round.
- A local proxy and failover.
