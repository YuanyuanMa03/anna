# Anna architecture

Current desktop design for the 1.0 candidate. Read [the iteration roadmap](roadmap.md) for planned work and [release and operations](release-operations.md) for installation, acceptance and release procedures. Historical review records do not validate a later candidate.

Sections: [processes](#processes), [kernels](#kernels-and-delegation), [permissions](#permission-policy), [stage](#the-stage), [data](#data), [speech](#speech), [provider routing](#local-provider-routing).

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
- Core asks main for secrets by name, and only four names are allowed: `credential.bin`, `weixin-credential.bin`,
  `providers.bin` and `senses.bin`.

## The kernel seam (`packages/kernels/`)

`AgentKernel` is the only interface between Anna and an agent brain. A kernel has two duties:

1. Call `gate(tool, input)` before every tool call. An ACP agent that runs a tool without asking can only be checked
   afterwards; the kernels and delegation section below says what happens then.
2. Emit normalized events: `thinking`, `text`, `tool-start`, `tool-end`, `compacting`, `retrying`.

Permissions, the stage, delivery stats, checkpoints and channels live in the Host and don't depend on the kernel. See
[kernels and delegation](#kernels-and-delegation) for the pi, Claude Code, Codex and ACP kernels.

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

When Claude Code, Codex or an ACP agent is Anna's brain, the kernel also serves Anna's own tools (memory, status, delegation) to it
as a local MCP server (`kernels/external/mcp.ts`, see [external-brain tools](#annas-own-tools-on-an-external-brain)).

Approval requests from an external agent go through Anna's own `gate`, so modes, rules, approval cards and checkpoints
apply to them too. Before each delegation, the workspace is snapshotted for diff and undo.

## Permissions (`packages/permissions/`)

See [permission policy](#permission-policy). `decide()` does not mutate state; it reads the file system (symlinks,
folder checks, `.gitignore` while looking for secret files in a search):

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

Anna has a second form, her own body: a mesh avatar of her original art (`apps/desktop/src/body-stage.vue`). It takes
the same props and events as the Live2D stage. The Director still decides which phase she performs; `character/body.ts`
turns that phase, the person's presence and touches into motions, expressions and gaze for the mesh-avatar runtime.
Asset distribution and licensing are recorded in `packages/character/README.md` and `NOTICE.md`; do not infer permission to redistribute private source artwork from runtime support.

## Data

| File | Contents |
|---|---|
| `settings.json` | v2: character, model, kernel, per-workspace `{ trusted, mode, rules }`, agents and providers. Migrated from v1 automatically |
| `credential.bin`, `weixin-credential.bin`, `providers.bin`, `senses.bin` | encrypted by the OS keychain (Linux without a keyring: 0600 file, flagged in the UI) |
| `pi-sessions/` | kernel sessions, the single source of the transcript |
| `external-sessions/` | transcripts when Claude Code, Codex or an ACP agent is the brain |
| `delegations.json` | session ids for continuing delegations |
| `checkpoints/<taskId>/` | file snapshots taken before edits, for undo |
| `memory.json` | long-term memory, viewable and deletable in the UI |
| `journal.json` | the last 40 tasks per workspace (request, status, changed files, collaborators, undo), briefed to a new session |
| `pi-agent/auth.json` | always `{}`; keys stay in memory |

The data directory is `~/Library/Application Support/Anna` on macOS, `%APPDATA%\Anna` on Windows and
`$XDG_DATA_HOME/anna` on Linux. Releases up to 0.5 kept it in `~/.local/share/anna-dsh` on macOS: the first launch moves it
(`anna-host/data-home.ts`) and leaves a link behind. Her memory, sessions and agent backups come along; her brain starts
fresh, and the old model and key stay in `before-0.6/`.

## Permission policy

Anna's permissions are modelled on [Claude Code](https://code.claude.com/docs/en/permissions) and
[Codex](https://learn.chatgpt.com/docs/agent-approvals-security) in three layers:

- **Modes** decide the default. Like a Codex preset, each one pairs what shell commands may touch (the sandbox) with
  when Anna asks (the approval policy).
- **Rules** remember your exceptions, in Claude Code's `Bash(...)`, `Read(...)` and `Edit(...)` format.
- **The OS sandbox** is the real boundary for shell commands.

### Four modes

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
| Other commands, network commands | ✗ | ask | ask | ✓ (sandbox, or acknowledged Windows Auto) |
| Risky commands (`rm -rf`, `git push`, `sudo`) | ✗ | ask (risky) | ask (risky) | ask (risky) |
| Network from the sandbox | ✗ | ask per domain | ask per domain | common registries allowed, others ask |
| Codex equivalent | read-only | workspace-write, ask before changes | workspace-write + on-request | workspace-write, no routine prompts |
| On stage | quiet, reading her notes | attentive, brows raised | neutral | leaning in, brisk |

- Press **Shift+Tab** in the input box to switch modes.
- Edit and Auto are only available in **trusted folders**. When you open a new folder, Anna asks whether you trust it.
  Untrusted folders don't load project instructions such as `AGENTS.md`.
- **Tasks from WeChat** always run in Ask mode, whatever the current mode is.
- Windows has no command sandbox. Auto requires an explicit first-use acknowledgement and a trusted folder; the choice is saved and can be revoked under Appearance & Capabilities. Existing saved Windows Auto settings without that acknowledgement fall back to Ask. Normal commands then run without routine prompts; risky commands, edits outside the workspace and secret reads still require one-time approval even if an allow rule exists. Revocation switches saved Auto workspaces to Ask.
- On macOS/Linux without a sandbox, Auto still asks before commands that change things. The macOS sandbox design is unchanged.
- On Windows, Edit directly permits plain, parseable workspace file operations (`Set-Content`, `Add-Content`, `Clear-Content`, `New-Item`, `Copy-Item`, `Move-Item`, `Rename-Item`) and verification commands. Other executors and network commands ask. PowerShell scriptblocks remain conservative; use the simple property form for read-only filter/sort pipelines.
- Approvals marked "risky" can only be granted once at a time, never for a session or permanently.
- Credential folders such as `~/.ssh` and `~/.aws` are ordinary paths outside the workspace, as in Claude Code: reads
  ask outside Auto mode, and **Always allow** saves a rule such as `Read(//Users/you/.ssh/**)`. That rule keeps
  working when `~/.ssh` is a symlink.
- Secret files ask in every mode before their contents go to the model. The same check applies whether the read tool
  names the file, a command names it (`cat .env`), or a recursive search would read it (`grep -r SECRET .`,
  `rg -uu`, the grep tool outside a git repository). Searches that skip gitignored or hidden files don't ask.
  On macOS/Linux, **Always allow** remembers that one file (`Read(./.env)`). Windows secret reads always ask once and do not offer a remembered rule. Listing names (`ls`, `find -name .env`, or pure `Get-ChildItem` metadata pipelines) does not read contents.
- Only Anna's own data directory (keys, settings, sessions, memory, checkpoints) is unreachable, whatever the mode,
  rule or approval. Both its path and the path it resolves to are checked, so a symlink or a `cd` into the real
  location doesn't get around it.

### Rules

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

Cards offer a separate remembered rule for each uncovered, non-read-only command part only when every required part has a safe template (`Bash(pnpm install *)`). The card lists the complete set, and a session/permanent approval remembers exactly that set. If any part is unparseable or would require an overly broad template such as `Bash(git *)`, the request stays one-time. High-risk and Windows secret approvals always stay one-time.
Every rule can be removed under **Appearance & Capabilities → Permission rules**.

### Sandbox

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

### Delegated agents

Claude Code runs with Anna's mode mapped to its own (`plan`, `default`, `acceptEdits`). It gets `Read` and `Edit` deny
rules for Anna's data directory, and its permission prompts land on Anna's cards. Codex gets the sandbox and approval
pair from the table above.

Anna's own tools reach Claude Code and Codex, when one of them is the brain, through a local MCP server on
`127.0.0.1` that answers only the bearer token Anna gave that agent at launch. The tools keep the rules they have on pi:
memory and status never ask, and delegation asks in Plan and Ask. Shell commands in Anna's sandbox can't reach it:
the sandbox refuses connections to local ports without even asking.

### Known limits

- pi's read and write tools run inside the core process, not in the OS sandbox, so only the policy engine guards them.
  The engine resolves paths exactly like pi and follows symlinks.
- The secret-file check reads what Anna can see: file names on the command line and a bounded walk of the folders a
  search covers. A program that opens files itself (`node`, `python`, a test run) isn't covered, the same limit
  Claude Code documents for its Read rules.
- Undo covers changes made by Anna's file tools (write and edit), not changes made by commands. Claude Code's
  checkpoints have the same limit.
- An ACP brain is checked when it asks. A call it starts without asking is checked only once it is reported, after it may
  have run, and such a change is not checkpointed: see the kernels and delegation section below.
- Command classes only reduce prompts; they are not a security boundary. Without a sandbox, trust only your own projects. Windows Auto uses the user’s OS permissions: literal paths, supported command syntax, secret reads and reported approval requests are checked, but arbitrary programs can open other files internally or compute indirect paths. It is not OS confinement. Content-reader wildcards and file-enumeration pipelines require one-time approval; pure metadata pipelines remain directly allowed.
- Anna's data directory is hidden from delegated agents only where the agent supports it. Claude Code gets deny rules
  through `--settings`. Codex's sandbox has no way to deny reads (its policies only limit writes), and Gemini CLI,
  OpenCode and Pi have none either, so those agents can read Anna's data while they work. Delegate to them only in
  folders you trust.

## Kernels and delegation

Anna uses other agents in two ways. Both are built on the adapters in `packages/agents/`.

- **Delegation**: pi is Anna's brain and the other agents are her colleagues. Mention one with `@claude <task>`, or let
  Anna decide through the `anna_delegate` tool. Implemented in `anna-host/delegator.ts`.
- **Brain swap**: from the brain chip in the corner (or **Model & Settings**), replace Anna's brain with Claude Code or Codex in
  one click; `agents/brains.ts` lists the choices and their state. Implemented in
  `kernels/external/kernel.ts`. The provider chosen for that agent under **External agents** applies here too, read
  again every turn, so Codex can run on DeepSeek's native Responses endpoint.

### Anna's own tools on an external brain

On pi, Anna's own tools (`anna_memory`, `anna_status`, `anna_delegate`) are pi custom tools. When Claude Code or Codex
is the brain, `kernels/external/mcp.ts` serves the same tools as a Streamable HTTP MCP server named `anna`:

- It listens on `127.0.0.1` on a random port, for as long as the kernel lives, and answers only requests that carry
  its random bearer token (one per kernel) and no browser `Origin`.
- Claude Code gets it through `--mcp-config`; the tools appear as `mcp__anna__anna_memory` and so on. Their permission
  prompts are normalized back to `anna_*` before Anna's gate, which allows them, as it does on pi.
- Codex gets it through `-c mcp_servers.anna.*` overrides, with `default_tools_approval_mode="approve"` and a one-day
  `tool_timeout_sec`.
- Either way, the tools decide when to ask, exactly as on pi: `anna_delegate` shows an approval card in Plan and Ask.
- Tool calls answer as an SSE stream that keeps sending MCP progress notifications (or keep-alive comments when the
  client asked for no progress), and Claude Code's server entry carries a one-day `timeout`: Claude Code otherwise
  aborts a tool that is silent for 300 s, and a delegation, or a wait on an approval card, easily takes longer.
- The brain's instructions name the tools under the agent's own spelling, so "call `anna_memory`" still lands.

### Adapter parts

| File | Responsibility |
|---|---|
| `agents/catalog.ts` | cc-switch's 14 apps plus ten more local agents from the ACP registry: detection, config folders, install and upgrade commands, tier (`delegate`, `switch`, `detect`) |
| `agents/detect.ts` | Searches `PATH` plus nvm, fnm, volta, mise, Homebrew and npm global folders; reads the version; runs each agent's own login-status command |
| `agents/launch.ts` | Maps Anna's mode, provider, session and persona to each agent's command-line flags |
| `agents/adapters/*` | Decodes each agent's headless output line by line into Anna's `KernelEvent`s and writes approval replies |
| `agents/runner.ts` | Starts the process, decodes it, sends approval requests through Anna's permission gate, handles interrupts |
| `agents/providers.ts`, `global.ts` | Provider presets (from cc-switch), per-delegation injection, global apply and restore |
| `agents/speedtest.ts` | Times a provider's addresses (cc-switch's speed test): a warm-up GET, then a timed one, in parallel |
| `agents/usage.ts` | Balances (DeepSeek, StepFun, SiliconFlow, OpenRouter, Novita) and Coding Plan quotas (Kimi, Zhipu, MiniMax), ported from cc-switch |
| `agents/deeplink.ts` | cc-switch's provider import links (`ccswitch://` or `anna://v1/import?resource=provider…`), checked and only ever previewed |
| `anna-host/agents-hub.ts` | The user's providers (from presets, by hand, imported, universal), keys in one encrypted secret, speed tests, balances, links, export / import |
| `agents/codex-catalog.ts` | Codex model catalog (`model_catalog_json`) for third-party providers, ported from cc-switch: context window, reasoning levels, image input and tool profile per model; DeepSeek uses its official catalog; `web_search` is turned off on gateways that reject it |

### Protocols

| Agent | Headless protocol | Approvals | Resume | Verified |
|---|---|---|---|---|
| Claude Code | `claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio` | per step: `control_request(can_use_tool)` → `control_response` | `--resume` | recorded on a real machine |
| Codex | `codex app-server` (JSON-RPC) | per step: `item/*/requestApproval` → `{decision}` | `thread/resume` | recorded on a real machine |
| Gemini CLI | `gemini -p --output-format stream-json` | once before the task; `--approval-mode` follows the mode | `--resume` | built from the source |
| OpenCode | `opencode run --format json` | once before the task; `--auto` in Edit and Auto | `--session` | built from the source |
| Pi | `pi --mode json` | once before the task; read-only tools in Plan and Ask | `--session-id` | built from the docs |

`agents/launch.ts` maps each Anna mode to the agent's native setting:

| Anna mode | Claude Code | Codex |
|---|---|---|
| Plan | `plan` | `untrusted` + `read-only` |
| Ask | `default` | `untrusted` + `workspace-write` |
| Edit | `acceptEdits` | `on-request` + `workspace-write` |
| Auto | `acceptEdits` | `on-request` + `workspace-write` |

In Auto mode, risky requests still go through Anna's gate and everything else is allowed. Anna's data directory is passed
to Claude Code as deny rules through `--settings`. Codex's sandbox policies only limit writes, so Codex can still read
it; see the known limits in [permission limits](#known-limits).

### ACP brains

Off by default: no real agent has run as her brain yet, only protocol fakes, and reading the agents' sources suggests real ones will be stopped early (a search with no path, a tool reported before it asks). Set `ANNA_ACP=1` to list them in the picker.

Any catalogued agent with `acp` arguments can be Anna's brain through the Agent Client Protocol
(https://agentclientprotocol.com): Gemini CLI, OpenCode, Grok Build, MiniMax Code, Kimi Code, Qwen Code, Cursor CLI,
GitHub Copilot CLI, Goose, Factory Droid, Auggie, CodeBuddy Code, Qoder CLI, Cline and Kilo. The arguments come from the
ACP registry (https://github.com/agentclientprotocol/registry). The brain id is `acp:<agent id>`; `kernels/acp/kernel.ts`
implements `AgentKernel`:

- One long-lived agent process and one ACP session (`initialize`, `session/new`). Each user message is a
  `session/prompt`, and Anna's instructions open the first one. Her own tools are offered as an HTTP MCP server when the
  agent takes one (`mcpCapabilities.http`).
- `session/update` streams her words (`agent_message_chunk`), thoughts and tool calls; ACP tool kinds map onto Anna's
  tool names (`execute` → `bash`, `edit`/`delete`/`move` → `edit`, `search` → `grep`).
- Every `session/request_permission` goes to Anna's gate, which picks the agent's allow-once or reject-once option.
  "Always" options are never picked, so each later call is asked again. A file call whose path is unknown is judged as
  outside the workspace.
- Anna offers no file system or terminal of her own (`clientCapabilities` false), so the agent uses its own tools. ACP
  does not make an agent ask before every call, and its own settings (auto-accept, yolo) can skip asking. So:
  - The whole agent process runs inside Anna's sandbox (`context.sandbox.wrap`): her data stays unreadable and
    unwritable, writes are limited to the workspace, temp and package caches, and every network host goes through her
    network approval. Wherever the sandbox is unavailable (Windows; Linux without bubblewrap or socat, or without ripgrep in a source build; a
    failed self-test; `ANNA_DISABLE_SANDBOX=1`) no ACP brain is offered or started.
  - A tool call that starts without having asked is checked when it is reported (`in_progress` or `completed`): a
    change (edit, shell, anything unknown) stops the turn at once with a message to switch the agent's own approvals to
    asking; a read, search or fetch goes through her gate and stops the turn if the gate says no. Either way the call
    may already have run. Nothing was checkpointed for it, because it never asked, so a change it made stays made; a read
    has already reached the agent. A call the agent never reports is limited by the sandbox alone.
- Abort sends `session/cancel`, and an open permission question is answered `cancelled`. An error answering the first
  prompt usually means the agent is not logged in; the message says so, with the end of the agent's stderr.

Known limits: agents that keep their own state outside the workspace and caches may fail to write it inside the
sandbox; in Plan mode the sandbox refuses all network, so an ACP brain cannot reach its model there; Anna's
own tools reach only agents that accept HTTP MCP servers.

Verified with a protocol-faithful fake (`tests/fixtures/fake-acp-agent.mjs`, unit tests and the desktop acceptance).
None of the real agents has been run as her brain on a real machine yet; each needs that before it is called verified.

### Adding an agent

1. Add an entry to `catalog.ts`. If cc-switch already supports the agent, match its entry. If it speaks ACP, add its
   `acp` arguments from the ACP registry and it can be her brain without an adapter.
2. Record a real session into `tests/fixtures/agents/` with `scripts/record-agent.mjs`. The script removes personal
   details. If you can't record one, write a synthetic sample from the public protocol.
3. Write the decoder, and replay the sample with `tests/agents-decoders.test.ts`.
4. Add the flag mapping in `launch.ts` and a case in `tests/agents-launch.test.ts`.
5. Run `tests/host-delegation.test.ts`, which uses a fake agent. With the real CLI installed, also run
   `ANNA_REAL_AGENTS=<id> pnpm test tests/agents-real.test.ts`.

## Speech

See [optional local speech setup and acceptance](release-operations.md#local-model-service) for service startup, model preparation and opt-in real-model checks.

Anna is a desktop application with direct speech services. It does not require New API, a gateway, a service workbench, Python or model weights to start. Existing brains, provider routing, tools, permissions, memories, avatars and Weixin remain available.

Open **语音对话 → 语音设置**. Recognition and synthesis each select **本地部署** or **云端 API**, independently. New forms start on **云端 API** with a Xiaomi MiMo Token Plan preset (`https://token-plan-cn.xiaomimimo.com/v1`, **接口格式** 对话接口, recognition `mimo-v2.5-asr`, synthesis `mimo-v2.5-tts` with voice `冰糖`), because a fresh install has no local speech service; only the key is missing. Pay-as-you-go MiMo keys (`sk-`) use `https://api.xiaomimimo.com/v1`. When recognition and synthesis use the same address, a key saved for one also serves the other, and it is never sent to any other address. Clearing one side's key does not stop the other side's key being used at that shared address; give them different addresses or clear both. Save a service address including its API prefix (usually `/v1`), the actual model ID, and its key if required. Synthesis also needs a voice ID. Changing service addresses requires entering a new key or explicitly clearing the previous one. The renderer only sees whether a key exists.

**接口格式** selects how speech is sent:

- **对话接口** (`chat`, Xiaomi MiMo's convention; OpenAI's own audio chat models also need `modalities` and are not covered): both directions use `POST /chat/completions`. Synthesis sends the text as the assistant turn and `audio: { format: "wav", voice }`, and reads base64 audio from `choices[0].message.audio.data`; the form suggests MiMo's built-in voices. Recognition sends the WAV as an `input_audio` data URL in the user turn (at most 10,000,000 characters including the prefix, about 7.5 MB of WAV; Anna's two-minute recordings are about 3.8 MB) and reads `choices[0].message.content`.
- **OpenAI 语音接口** (`audio`, the default for older settings and local services):
  - Recognition uses `POST /audio/transcriptions`, multipart fields `model`, `file` and `response_format=json`, and expects `{ "text": "..." }`.
  - Synthesis uses `POST /audio/speech`, JSON fields `model`, `voice`, `input` and `response_format=wav`.

For both:

- Synthesised audio must be WAV, MP3, Ogg or FLAC. A reply labelled `application/octet-stream`, a variant WAV/MP3 spelling or no type at all is accepted when its own header is one of these.
- Saving one side on the cloud preset's address also saves the other side with its preset, if that side was never set up and is untouched, so a new user enters one key and saves once.
- In conversation, the next sentence is synthesised while the current one plays.
- A 401 or 403 says the key is invalid or does not match the address; a 404 or 405 suggests checking the address and 接口格式. Provider error text is never shown.
- Local mode accepts loopback services (`127.0.0.1`, `localhost`, `::1`), including HTTP. Cloud mode requires HTTPS. Neither follows redirects.
- These are compatible API contracts, not adapters for every provider's proprietary protocol. Confirm that the selected service supports the required endpoint.

Select an audio file or explicitly start microphone recording. Recordings are converted to PCM16 mono 16 kHz WAV without playback, limited to two minutes and a 20 MiB input. Recognition sends the audio only to the saved recognition endpoint. Check/edit the transcript, then choose **将文字带到对话** or **发送并语音回复**. The latter uses the current brain and enables model speech for this app session. It is disabled until a synthesis service is saved and the current workspace is ready for chat.

Model speech starts off at every launch. The homepage can stop playback or disable it. Closing the voice panel stops microphone capture and cancels its pending recognition/synthesis requests. Cancellation stops Anna from receiving or playing the result; a remote model may finish its underlying inference. A canceled or late permission grant cannot restart recording. Camera, screen capture and visual inference are outside the desktop scope. Continuous voice and any future wake-word or background-microphone behavior are planned separately; their capture scope requires an explicit user decision.

The synthesis test creates a downloadable audio file without automatically playing it. Cloud requests may incur the selected provider's charges. Voice input through a local recognizer does not make a cloud language model local: the current brain still determines where the transcript is processed.

### Upgrade and distribution

Existing TTS settings and keys continue to use the encrypted `senses.bin` vault; the filename is retained for compatibility. Missing legacy mode is inferred from the endpoint. Existing recognition model copies, vision credentials, New API databases and any separately running services are left untouched. This change removes their application code and entry points; it does not uninstall other software or delete user data. Existing agent providers may still point to an independently managed compatible gateway.

Desktop packages collect the Host's actual runtime dependency closure and archive it into `app.asar`, retaining dependency versions and peer contexts. Electron is supplied by the outer application. Frontend-only dependencies and Sherpaw WASM are not installed again inside the runtime. Sandbox executables and their small dependency closure remain outside the archive so executable paths stay real. Native addons are unpacked. License files are preserved; source maps and declaration-only files are omitted from the distribution. Source builds and packaged desktop flows must both pass.

Windows packages can be built on macOS or Windows. Cross-building and static checks do not prove target-platform startup; test the resulting installer on Windows. See [release and operations](release-operations.md).

### Verification boundaries

Automatic desktop checks use synthetic WAV data, fake speech HTTP responses, fake brains and mocked playback. They validate routing, conversion, persistence, cancellation and interaction, not transcription accuracy, voice quality or real microphone compatibility. The optional Python protocol suite uses a fake recognizer and synthetic waveform. Opt-in local model acceptance uses a separately running local service and a public/synthetic reference recording; it never opens real devices or plays audio. Cloud provider compatibility and target-platform model availability require separate acceptance.

## Local provider routing

> The implementation stages below retain the P2a–P2e names used by the existing routing code and tests. Conversion, failover, global routing and aggregation are built. Conversion code and test fixtures are ported from [cc-switch](https://github.com/farion1231/cc-switch) (MIT); dated verification below describes earlier revisions, not fresh acceptance of this candidate.

### Routing purpose

A coding agent speaks one API format: Claude Code speaks Anthropic Messages, Codex speaks OpenAI Responses, Gemini CLI
speaks Gemini's own. Many providers speak only OpenAI Chat Completions. Local routing sits between the agent and the
provider, converts the format, and can move a request to another provider when one fails.

### Routing layers

- **Anna's own runs (first).** Delegations and Claude Code / Codex as Anna's brain are started by Anna, so the routing
  address is injected at launch, like a provider today. No config file changes; nothing to undo when Anna quits.
- **Global routing (P2d, opt-in per agent).** Like cc-switch, the agent's own config points at Anna, so the CLIs the
  user runs in a terminal are routed too. Needs Anna running; the original config is written back on quit and repaired
  on the next start after a crash.

#### P2d as built

- **The switch.** "终端里的 X 也走 Anna 的路由" on the Claude Code and Codex provider tabs (settings
  `routing.global`). The terminal's agent then uses the provider in use in Anna and its backups — one choice for Anna's
  runs and the terminal — and follows every change at once: the route is updated in place, and the config is
  rewritten only when what the agent sees changes (Codex's model and catalog, Claude Code's model names).
- **What goes into the agent's config** (`packages/agents/takeover.ts`), only connection fields:
  - Claude Code `settings.json` `env`: `ANTHROPIC_BASE_URL` (the route on 127.0.0.1:15722), `ANTHROPIC_AUTH_TOKEN`
    (the route's token), and per tier `ANTHROPIC_DEFAULT_*_MODEL` = cc-switch's current Claude aliases
    (`claude-sonnet-5`…, `[1M]` kept) with `*_MODEL_NAME` = the provider's model. The routing maps the aliases back.
    Every other connection key (`claudeConnectionKey`) is set aside, and so is a top-level `apiKeyHelper`, whose key
    Claude Code would send instead of the route's token.
  - Codex `config.toml`: `model_provider = "custom"`, the provider's `model`, Anna's model catalog, and a
    `[model_providers.custom]` table with the route and its token as `experimental_bearer_token` — `auth.json` and the
    ChatGPT login in it are not touched.
- **Giving it back.** On quit, when switched off, and when it can't be kept up (no provider chosen, the port taken):
  a file untouched since Anna wrote it goes back byte for byte (or away, if there was none); one changed meanwhile —
  by the user, or by the agent itself, e.g. a permission rule — gets only its connection fields back, the rest stays.
  Renewing the takeover (a provider, backup or key change) keeps that distinction: once the file changed since Anna
  last wrote it, the byte-for-byte copy is dropped for good, so a later release can't undo those changes. An
  `apiKeyHelper` or `modelPicker` set while Anna holds the file is the user's own now: it is the one set aside and put
  back, not the value from before the takeover. Codex's connection lines (`model`, `model_reasoning_effort`…) work the
  same way: one the user changed or added while Anna holds config.toml is the one put back. Keys are compared
  regardless of order, since Claude Code may rewrite settings.json in another order. A key the user deleted while held
  (Anna had already set it aside) still comes back on release: there is no way to tell that deletion from Anna's own.
  The replaced fields and the original file are saved before the first write, so after a crash the next start renews
  the takeover (still switched on) or gives the config back (switched off).
- **The token** is one per agent, kept with the keys in the encrypted store, so the config stays valid across
  restarts. Global routing and the direct "应用到全局" exclude each other.
- **Failover settings** (P2c's numbers) can be changed per agent under "换用备用的超时与暂停": retries, first-byte
  and idle timeouts, failures before a pause, and the pause; "恢复默认" goes back to cc-switch's defaults.
- Tests and Anna's scripted desktop run use config folders inside their data folder and a random port, never `~`.

### Routing service

- An HTTP server in the core process, on `127.0.0.1` only. Anna's own runs use a random port; global routing uses a
  fixed port (default 15722, next to cc-switch's 15721 so both can run).
- Paths by agent: `/codex/v1/responses`, `/claude/v1/messages`, `/gemini/…`.
- **Real keys never leave the core.** The agent gets a route token as its key: one per run for Anna's runs, one per
  agent for global routing. The service accepts only known tokens, then sends the request upstream with the real key.
  Requests with a browser `Origin` are refused.
- Upstream addresses come only from the user's providers and follow the same rule as direct use: HTTPS, or HTTP to
  this machine or the local network.
- No keys or request bodies in logs. Each request records provider, model, status, latency and token usage, for P4's
  usage statistics.
- No new dependencies: Node's `http` and `fetch`.

### Format conversion

| Agent | Upstream | Phase |
|---|---|---|
| Codex (Responses) | Chat Completions | P2a |
| Claude Code (Anthropic Messages) | Chat Completions | P2b |
| Claude Code | Responses, Gemini | P2b, later |
| Codex | Anthropic Messages | later |

- Request and streaming response are both converted: text, tool calls (parallel ones and tool results without a
  matching call included), reasoning (`reasoning_content` and the like, replayed where the upstream needs it),
  images, usage, errors.
- cc-switch's test cases are ported as fixtures, so behavior matches it case by case.
- A Codex provider reached through Chat gets cc-switch's classic tool template in its model catalog (Chat has no
  freeform `apply_patch`).
- Presets that cc-switch marks as needing routing (`apiFormat: openai_chat` for Codex) become available, labelled
  "经本地路由"; the provider card shows it too.

#### P2a as built

- `packages/routing`: `codex-chat.ts` (request, non-streaming response, errors), `codex-chat-stream.ts` (Chat SSE →
  Responses SSE), with `compaction.ts`, `inline-think.ts`, `tool-media.ts` and `json.ts` ported alongside;
  `server.ts` is the service. `packages/agents/route.ts` opens a route for a run; the delegator and the external
  kernel close it when the run ends.
- Presets keep cc-switch's `codexChatReasoning` as `chatReasoning`; per-model reasoning levels from the preset's model
  rows clamp the effort for providers that need it (OpenCode's `zen`). Providers imported from cc-switch's database,
  from links and from Anna's export files keep their format too; a hand-written Codex provider picks it in the editor.
- The Chat profile of the model catalog lists MCP tools up front (`supports_search_tool: false`) rather than behind
  `tool_search` as cc-switch does: Anna's own tools must be in front of the brain every turn.
- Not ported: cc-switch's cache of earlier tool calls for requests that send only `previous_response_id`. Codex sends
  the whole conversation to a custom provider, and Anna's runs are always custom providers.
- Each request is kept in memory (the latest 500) with provider, model, status, latency, tokens and how a stream
  ended; P4 turns them into statistics.
- Global use of a Chat-format provider requires the opt-in global routing described above; direct global application cannot perform format conversion.

#### P2b as built

- `claude-chat.ts` (request, non-streaming reply, usage) and `claude-chat-stream.ts` (Chat SSE → Anthropic SSE), from
  cc-switch's `transform.rs` and `streaming.rs` with their test cases. The service answers `POST /claude/v1/messages`
  for Claude Code's routes and takes the token from `x-api-key` or `Authorization`; Claude Code gets the route as
  `ANTHROPIC_BASE_URL` and the token as `ANTHROPIC_AUTH_TOKEN`.
- The provider's endpoint follows each agent's convention for base URLs, as cc-switch builds it: Codex's include the
  version (`…/v1` + `/chat/completions`), Claude Code's don't (`…` + `/v1/chat/completions`, a doubled `/v1/v1`
  collapsed). A full `…/chat/completions` address is used as it is.
- Model names: one of the provider's own models (its `ANTHROPIC_*_MODEL` settings) goes as it is; a Claude tier name
  (haiku, sonnet, opus, fable) maps to that tier's model; anything else to the default. The `[1M]` suffix, which only
  tells Claude Code the context size, is dropped.
- DeepSeek and MiMo get a tool-call turn's thinking back as `reasoning_content` (cc-switch's rule, by model or
  address); `reasoning_effort` only for models that take it (o-series, GPT-5+, Grok 4.5+).
- Beyond cc-switch: an error event in the provider's stream is passed to Claude Code as an Anthropic `error` event
  (cc-switch drops it and the turn just stops); `message_start` carries the full message shape (`content: []`).
- Presets: cc-switch's four Chat-format Claude Code presets. `count_tokens` is not served (404), as in cc-switch.

### Failover

- Per agent, a queue of providers; a request that fails before its first byte reaches the agent (connection error,
  5xx, 429, first-byte timeout) moves to the next. Once streaming has started, an error is passed to the agent, which
  has its own retries; output from two providers is never spliced.
- A circuit breaker per provider (closed, open, half-open) with cc-switch's defaults (more lenient for Claude Code),
  adjustable; health badges on provider cards.
- When a failover happens during a task, the stage says so, and `anna_providers` reports the queue and health.

#### P2c as built

- **The queue.** Claude Code and Codex each keep backups next to the provider in use (settings `agents.<agent>.backups`),
  set from the provider cards ("设为备用", ↑ ↓, "移出备用") or by the companion with `anna_providers` action `backups`
  after the user approves the card. Renames and deletes keep it in step; the provider in use is never its own backup;
  an agent's own login can't be one (Anna can't route it). Gemini CLI has no routing, so no backups.
- **When a run is routed.** A Chat provider always; any provider once it has backups. Without backups a native
  provider is reached directly and a Chat one through one try with no timeouts and no breaker — exactly as in P2a/P2b.
- **Native passthrough** (`packages/routing/server.ts`): a provider in the agent's own format gets the request as it
  is — Codex's at `…/responses`, Claude Code's at `…/v1/messages` with its `anthropic-version` / `anthropic-beta`
  headers and query, the key in `x-api-key` or `Authorization` per the provider's key field — and the stream comes
  back byte for byte (read only for the records). Codex's hosted `web_search` is dropped for gateways known to reject
  it. Each provider gets its own model: Codex asks for the first provider's; Claude Code's tiers map through the first
  provider's names to the same tier here.
- **What moves on** (before the agent has any byte): unreachable, an HTTP status other than 400/405/406/413/414/415/
  422/501, no first byte in time, an empty stream. At most `maxRetries + 1` providers per request. After the first
  byte, a stream silent for `idleTimeout` is ended as failed (Codex gets `response.failed`, Claude Code an `error`
  event) and the provider's request stops.
- **Breaker** (`packages/routing/breaker.ts`): cc-switch's state machine and per-app defaults, in memory (closed again
  after a restart).

  | | retries | first byte | idle | breaker opens after | open for | closes after | error rate (min requests) |
  |---|---|---|---|---|---|---|---|
  | Claude Code | 6 | 90 s | 180 s | 8 failures | 90 s | 3 successes | 70 % (15) |
  | Codex | 3 | 60 s | 120 s | 4 failures | 60 s | 2 successes | 60 % (10) |

  A malformed request (the statuses above) counts neither way. Cards show "暂停中" (open) and "试探恢复中"
  (half-open); `anna_providers` list says the same. The numbers can be changed per agent (see P2d).
- **On stage.** A delegation's card line says "DeepSeek 返回了 503，换成 Kimi" and names the provider now working; with
  the brain, the companion's line says it in the retry pose.
- **Known limit.** Codex's model catalog follows the provider in use, so a native Responses backup behind a Chat
  provider still gets Codex's freeform `apply_patch` tool, which some native gateways reject.

### Aggregation

Several providers' models in one model list, requests routed by model name (prefix `anna-`). Mainly for global
routing, where the user picks models in the agent itself; Anna's runs already pick a provider per run
(`@codex/Kimi`).

#### P2e as built

After cc-switch's Stack mode (`mode/stack.rs`).

- **The list.** With global routing on, "终端的模型列表里也列出" under the switch lists the agent's other providers
  that Anna can route (settings `routing.aggregate`). Their models join the agent's own model list (`/model` in both
  CLIs); picking one sends the requests straight to that provider. Every other model name goes to the provider in use
  and its backups, as before. The provider in use isn't listed a second time while it is in use (its models are the
  agent's default ones); it stays on the list for when it no longer is.
- **Model ids.** Claude Code `anna-claude-<key>--<model>` (with `[1M]` when the provider's setting has it), Codex
  `anna-<key>/<model>`. `<key>` comes from the provider's name (lowercase letters, digits and single dashes, at most 24;
  `p` and a hash for a name with none of those; `-2`, `-3`… when taken), is given once and kept for good (settings
  `routing.keys`): a renamed provider keeps its key, a deleted one keeps it reserved, so an id an agent still remembers
  never reaches another provider.
- **Where they show up.**
  - Claude Code: `settings.json` `modelPicker.options`, after the built-in rows (which are the provider in use's
    tiers): one row per model in the provider's model settings (`ANTHROPIC_MODEL` and the tiers, deduplicated), label
    `<model>（<provider>）`, and `behavesAs: claude-sonnet-5`, so Claude Code handles a model it doesn't know like a
    known one instead of guessing its context window. Claude Code reads `modelPicker` from user settings (verified on
    2.1.302). The takeover sets a user's own `modelPicker` aside, like `apiKeyHelper`, and puts it back on release.
  - Codex: Anna's model catalog — the provider in use's rows as before, then each listed provider's rows from its own
    catalog (a Chat provider's from the classic tool template, a native one's from its vendor's or the neutral one)
    with the prefixed slug, display name `<name>（<provider>）`, and the following priorities.
- **Routing.** A request for a prefixed id goes to that provider alone, with the model part as its model: no backups,
  no breaker (cc-switch's rule — another provider would answer with another model, on another bill, and the user
  couldn't tell). An id that no longer resolves (a provider taken off the list or deleted, an unknown key, a malformed
  id) gets a 400 in the agent's format saying to pick a model again; it never falls back to the provider in use.
- **Not ported**: cc-switch's merging of members' Claude Code compatibility switches and context-window keys into the
  one `settings.json`, its Claude Desktop ids, and Codex's `multi_agent_version` override.

### Routing verification

- Unit: request and stream conversion against the ported fixtures; token checks; failover and breaker states.
- Real agents without keys: a fake upstream that speaks Chat Completions, with the real Codex (P2a) and Claude Code
  (P2b) pointed at the routing service, finishing a turn with tool calls. P2a: `ANNA_REAL_AGENTS=codex pnpm vitest run
  tests/agents-real.test.ts -t "local routing"` (Codex 0.160: a freeform `apply_patch` call, and Codex as Anna's brain
  calling `anna_memory`). P2b: `ANNA_REAL_AGENTS=claude … -t "real Claude Code through"` (Claude Code 2.1.302: its
  `Write` tool, and Claude Code as Anna's brain calling `anna_memory`). P2c: `ANNA_REAL_AGENTS=codex,claude … -t
  "failing over"`: the provider in use answers 503, the backup is a provider in the agent's own format (a second Anna
  route in front of the scripted upstream), and both agents finish the edit without seeing the 503. P2d:
  `… -t "global routing"`: the real `codex exec` and `claude -p`, run with their own (taken-over) config folder and no
  Anna variables in the environment, answer through the route. P2e: `… -t "aggregated"`: the same CLIs asked for a
  listed provider's model by its prefixed id (`-m` / `--model`) answer from that provider, and an unknown id fails
  with the message to pick again.
- With a key the user provides: one real provider per conversion. P2a: DeepSeek's Chat API (`deepseek-flash`) with
  `ANNA_REAL_CHAT_KEY` (`-t "real Chat provider"`): a delegated file edit over six turns, all 200, prompt cache hits
  from the second turn; and Codex as Anna's brain saving a memory with `anna_memory`. P2b, the same key and model with
  Claude Code: a delegated file edit in two turns (21120 of 21353 input tokens cached on the second) and the brain
  saving a memory.
