# Architecture (v0.4)

```
┌──────────── Electron main ─────────────┐        ┌──────────────── Anna core (utilityProcess) ─────────────────┐
│ windows, menus, dialogs, notifications │  RPC   │ Host: task queue · permission gate · approvals ·            │
│ OS keychain vault (decrypts only here) │◄──────►│       checkpoints · memory · delegator · agents hub         │
│ updater                                │        │   │              │                                          │
│ core crashed → restart (≤ 3 / minute)  │        │   ▼              ▼                                          │
└───────────────▲────────────────────────┘        │ AgentKernel     Presence (kernel events → stage state)      │
                │ Eventa IPC (fixed preload)       │ (pi · Claude    Channels (WeChat ClawBot)                   │
┌───────────────┴────────────────────────┐        │  Code · Codex)  CommandSandbox (Seatbelt / bubblewrap)      │
│ Renderer: Live2D stage, director, cards │        └─────────────────────────────────────────────────────────────┘
└────────────────────────────────────────┘
```

## Processes

- **main** (`apps/desktop/main.ts`) owns windows, menus, folder pickers, system notifications, the updater and the OS
  keychain. It only encrypts and decrypts; it never runs an agent.
- **core** (`apps/desktop/core.ts`) is an Electron `utilityProcess`. The Host, kernels, sandbox proxy and WeChat channel
  run here, so long tasks, context compaction and big searches never freeze the window. If core crashes, main restarts
  it and the session resumes from the kernel's JSONL log.
- The two talk through `packages/shared/rpc.ts`. Once core exits, new calls on the old connection fail immediately
  instead of hanging.
- Core asks main for secrets by name, and only three names are allowed: `credential.bin`, `weixin-credential.bin` and
  `providers.bin`.

## The kernel seam (`packages/kernels/`)

`AgentKernel` is the only interface between Anna and an agent brain. A kernel has two duties:

1. Call `gate(tool, input)` before every tool call.
2. Emit normalized events: `thinking`, `text`, `tool-start`, `tool-end`, `compacting`, `retrying`.

Permissions, the stage, delivery stats, checkpoints and channels live in the Host and don't depend on the kernel. See
[kernels.md](kernels.md) for the pi, Claude Code and Codex kernels.

The pi kernel (`kernels/pi/kernel.ts`) works like this:

- It uses pi's `createAgentSession` and keeps pi's own coding system prompt. Anna's persona, workspace, permission and
  memory instructions are appended after it.
- Context compaction and retries are automatic. JSONL sessions live in `pi-sessions/`.
- Extension code from the workspace is never loaded (`noExtensions`). Untrusted folders also skip `AGENTS.md`, skills
  and prompt templates.
- With a sandbox available, pi's `bash` tool is replaced by a sandboxed one. The other tools are pi's own.
- The transcript is derived from the session branch only. Origin (desktop or WeChat) and interruptions are stored as
  custom entries that never reach the model. A mode change is written as a custom message, so the model knows about it.

## External agents (`packages/agents/`)

Detection follows cc-switch. Besides `PATH`, Anna searches version-manager and package-manager directories, because a
GUI app doesn't inherit the terminal's `PATH`.

Delegation and brain-swapping share the same adapters:

- `launch` builds the command line.
- `adapters` decode the output stream.
- `runner` manages the process and forwards approvals.

Approval requests from an external agent go through Anna's own `gate`, so modes, rules, approval cards and checkpoints
apply to them too. Before each delegation, the workspace is snapshotted for diff and undo.

## Permissions (`packages/permissions/`)

See [permissions.md](permissions.md). `engine.decide()` is a pure function:

- **In:** the mode, rules, workspace, whether a sandbox exists, and the tool call.
- **Out:** `allow`, `ask` or `deny`.

Path resolution matches pi exactly and follows symlinks. The OS sandbox is the real boundary; command classes only
reduce how often Anna has to ask.

## The stage

**Presence** (`anna-host/presence.ts`) turns kernel events into an `AnnaState`. Parallel approvals stack, and the
previous pose comes back only after all of them are resolved.

**Director** (`character/director.ts`) adds three layers on top of the pose:

- Priority and a minimum dwell time.
- A stance per permission mode:

  | Mode | Stance |
  |---|---|
  | Plan | quietly reading her notes |
  | Ask | attentive, brows slightly raised |
  | Edit | neutral |
  | Auto | leaning in, quicker rhythm |

- A one-off gesture when the mode changes: a nod and smile when permissions widen, a head tilt when they narrow.

The halo and mode badge colors follow the mode: Plan is blue, Ask amber, Edit lavender and Auto green. While another
agent works, Anna switches to a "supervising" pose.

## Linux: Chromium sandbox

Chromium's own process sandbox (separate from the bubblewrap sandbox that confines shell commands) needs either
unprivileged user namespaces or a root-owned setuid `chrome-sandbox`. Ubuntu 23.10+ sets
`kernel.apparmor_restrict_unprivileged_userns=1`: only programs with an AppArmor profile that allows `userns` get
them. Without one, Electron aborts at startup.

The Linux package therefore ships `Anna/anna` as a small launcher (`scripts/linux-launcher.sh`) next to the Electron
binary `Anna/anna-bin`. The `anna` command, the desktop entry and the updater all start the launcher, which runs
`anna-bin` with the sandbox when any of these holds:

1. `unshare --user --map-root-user true` succeeds (most distributions, or Ubuntu with the restriction turned off);
2. `chrome-sandbox` is setuid root (an administrator set it up by hand);
3. an `anna-*` profile in `/etc/apparmor.d` names this `anna-bin`.

Otherwise it adds `--no-sandbox` and prints how to fix it. Starting is better than a crash, and the renderer only
loads Anna's own bundled pages. Agent commands still run under bubblewrap, and the permission gate is unchanged.

`install.sh` never uses sudo unless asked. When the restriction is on, it prints the opt-in. With
`ANNA_INSTALL_APPARMOR=1`, it writes `/etc/apparmor.d/anna-<uid>`, which allows `userns` for the resolved path of
that user's `anna-bin`, and loads it with `apparmor_parser -r`. This is the same kind of profile Ubuntu ships for
Chrome and other Electron apps. The binary sits in a user-writable directory, so the profile gives that user's own
programs no more than they had before Ubuntu 23.10. We don't set the setuid bit on `chrome-sandbox` ourselves: a
setuid-root file in a user-writable directory is a worse trade.

CI packages the Linux build on Ubuntu 24.04 and runs the scripted acceptance against it twice: once straight from
the package (the `--no-sandbox` fallback), and once installed by `install.sh` with the AppArmor profile, which
asserts that Chromium's sandbox is on.

## Data

| File | Contents |
|---|---|
| `settings.json` | v2: character, model, kernel, per-workspace `{ trusted, mode, rules }`, agents and providers. Migrated from v1 automatically |
| `credential.bin`, `weixin-credential.bin`, `providers.bin` | encrypted by the OS keychain (Linux without a keyring: 0600 file, flagged in the UI) |
| `pi-sessions/` | kernel sessions, the single source of the transcript |
| `external-sessions/` | transcripts when Claude Code or Codex is the brain |
| `delegations.json` | session ids for continuing delegations |
| `checkpoints/<taskId>/` | file snapshots taken before edits, for undo |
| `memory.json` | long-term memory, viewable and deletable in the UI |
| `pi-agent/auth.json` | always `{}`; keys stay in memory |

The data directory is `~/.local/share/anna-dsh` on macOS (kept from earlier releases), `$XDG_DATA_HOME/anna` on Linux
and `%APPDATA%\Anna` on Windows.
