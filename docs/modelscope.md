# ModelScope browser deployment

The browser build is the whole Anna: the Vue/Live2D renderer talks to a `Host` (pi kernel, command sandbox, approvals,
checkpoints, memory, delegation to Claude Code and Codex) over HTTP and server-sent events instead of Electron IPC.

## Shape

- `apps/web/server.ts` serves the renderer, keeps visitor sessions and runs the inference relay.
- Each visitor gets `apps/web/core.ts` in its own child process. When the server runs as root (the Studio), that
  process runs as its own Unix user (uid 20001+), so visitors cannot read each other's files. The command sandbox
  (`@anthropic-ai/sandbox-runtime`, bubblewrap on Linux) is process-wide, which is another reason for one process per
  visitor.
- `apps/web/seed.ts` writes a new visitor's settings and a small demo project into their default workspace.
- `apps/web/commands.ts` is the command allowlist: everything a desktop user does inside Anna, minus what reaches
  outside the visitor's home (folder pickers, WeChat, updates, agent installs, import/export, custom provider endpoints).

## Model access

The ModelScope key (`ANNA_MODEL_API_KEY`) stays in the server process. Anna, Claude Code and Codex use the relay on
`127.0.0.1:7870` with a per-visitor token; the relay swaps it for the key, allows only the demo models, rate-limits each
visitor and, when a model's free quota runs out (HTTP 429), falls back through `ANNA_FALLBACK_MODELS`. Claude Code and
Codex reach the relay through Anna's own local routing, as a Chat Completions provider.

Variables: `ANNA_MODEL` (Anna, default `Qwen/Qwen3.5-35B-A3B`), `ANNA_AGENT_MODEL` (Claude Code / Codex, default
`Qwen/Qwen3.5-397B-A17B`), `ANNA_FALLBACK_MODELS`, `ANNA_MAX_SESSIONS` (default 12), `ANNA_WEB_DATA`.

## Local run

```sh
pnpm install --frozen-lockfile
pnpm assets
pnpm build:web
ANNA_MODEL_API_KEY=... pnpm start:web
```

Open http://127.0.0.1:7860. Locally the server is not root, so every visitor shares your user; the sandbox is Seatbelt
on macOS.

## Deploy

```sh
pnpm build:web
node scripts/package-modelscope.mjs
```

Publish `artifacts/modelscope/` to the Docker Studio's `master` branch with a credential helper (never a token in the
remote URL), set the `ANNA_MODEL_API_KEY` secret, and deploy on free hardware only. Port 7860.

## Limits

A visitor session allows 8 messages and 30 model calls a minute and expires after 2 idle hours; the Studio holds 12
sessions. Delegated agents run as the visitor's user but outside the command sandbox, as on the desktop. These are
demonstration controls, not an internet-scale tenancy system.
