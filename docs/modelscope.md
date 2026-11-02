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
`Qwen/Qwen3.5-397B-A17B`), `ANNA_FALLBACK_MODELS`, `ANNA_MAX_SESSIONS` (default 12), `ANNA_MAX_SESSIONS_PER_CLIENT` (default 4), `ANNA_PUBLIC_PROXIES` (default 0),
`ANNA_RELAY_PER_MINUTE` (default 120), `ANNA_RELAY_PER_DAY` (default 1500), `ANNA_RELAY_PER_CLIENT_DAY` (default 500),
`ANNA_WEB_DATA`.

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

After a deploy, open `/healthz` from two networks: `client` should be each network's own public address. `ms.show` sits
behind a web application firewall, so it may show a proxy's address instead, which makes many visitors look like one
client. Set `ANNA_PUBLIC_PROXIES` to the number of public proxies to skip and restart. Until that's right, raise
`ANNA_MAX_SESSIONS_PER_CLIENT` and `ANNA_RELAY_PER_CLIENT_DAY`; neither needs a new build.

## Limits

A visitor session allows 8 messages and 30 model calls a minute (each call asks for one answer, and a requested
length is capped at 16384 tokens), expires after 2 idle hours, or after 30 minutes once no tab has it open, and ends
after 4 hours however busy.

The Studio holds 12 sessions. A client may open 6 a minute and hold 4 at once, and a page on another site can't open
one: browsers say where a request comes from (`Sec-Fetch-Site`), and only the demo's own page is accepted. The client
is the rightmost `X-Forwarded-For` entry outside the platform's network, after skipping `ANNA_PUBLIC_PROXIES` public
proxies.

Every upstream attempt, including a fallback, draws on one shared budget: 120 a minute and 1500 a day for all visitors together, and 500 a day for one
client. The day turns over at midnight in Beijing. These local counters reset when the server restarts; they do not report
the provider's remaining balance.

Isolation, and where it stops:

- A visitor's folder has a random name unrelated to the session token (folder paths show in `ps`), mode 0700, owned
  by the visitor's uid; the visitor's processes run with umask 077, so files they leave in `/tmp` are theirs alone.
- uids rotate through 20001–29999 instead of being reused right away. Closing a session kills the uid's processes,
  retrying for a couple of seconds, and deletes its files in `/tmp`, `/var/tmp` and `/dev/shm`.
- Anna's own (pi) shell commands run in the command sandbox. Claude Code and Codex, delegated, run as
  the visitor's user **outside** it, as on the desktop: they can reach the network (the Studio's egress), but not
  another visitor's files or the ModelScope key.
- Switching her brain is desktop only: an external brain carries Anna's tool token and the diary on its command line,
  which every other visitor can read from `ps`. A delegated run carries neither.
- Global routing, provider backups and routing policies are desktop only: the routing server's port is shared by
  every visitor, and the relay is the only provider to route to.

These are demonstration controls, not an internet-scale tenancy system.

Operator variables: `ANNA_SELF_TEST=1` runs one throwaway visitor through `npm test` in auto mode at startup and logs
the outcome (`ANNA_SELF_TEST_TEXT` sets the task; it approves everything it is asked, so set it only to check a deploy
and remove it after, since each cold start spends quota); `ANNA_RELAY_DEBUG` logs each relay call; `ANNA_TZ` sets the
visitors' time zone (default Asia/Shanghai).
