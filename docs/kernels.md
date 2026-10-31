# Kernels and external agents

Anna uses other agents in two ways. Both are built on the adapters in `packages/agents/`.

- **Delegation**: pi is Anna's brain and the other agents are her colleagues. Mention one with `@claude <task>`, or let
  Anna decide through the `anna_delegate` tool. Implemented in `anna-host/delegator.ts`.
- **Brain swap**: from the brain chip in the corner (or **Model & Settings**), replace Anna's brain with Claude Code or Codex in
  one click; `agents/brains.ts` lists the choices and their state. Implemented in
  `kernels/external/kernel.ts`. The provider chosen for that agent under **External agents** applies here too, read
  again every turn, so Codex can run on DeepSeek's native Responses endpoint.

## Anna's own tools on an external brain

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

## Adapter parts

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

## Protocols

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
it; see the known limits in [permissions.md](permissions.md#known-limits).

## ACP brains

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
    network approval. Wherever the sandbox is unavailable (Windows; Linux without bubblewrap, socat and ripgrep; a
    failed self-test; `ANNA_DISABLE_SANDBOX=1`) no ACP brain is offered or started.
  - A tool call that starts without having asked is checked when it is reported (`in_progress` or `completed`): a
    change (edit, shell, anything unknown) stops the turn at once with a message to switch the agent's own approvals to
    asking; a read, search or fetch goes through her gate and stops the turn if the gate says no. Either way the call
    may already have run: a change can be undone with the workspace checkpoint, and a read has already reached the
    agent. A call the agent never reports is limited by the sandbox alone.
- Abort sends `session/cancel`, and an open permission question is answered `cancelled`. An error answering the first
  prompt usually means the agent is not logged in; the message says so, with the end of the agent's stderr.

Known limits: agents that keep their own state outside the workspace and caches may fail to write it inside the
sandbox; in Plan mode the sandbox refuses all network, so an ACP brain cannot reach its model there; Anna's
own tools reach only agents that accept HTTP MCP servers.

Verified with a protocol-faithful fake (`tests/fixtures/fake-acp-agent.mjs`, unit tests and the desktop acceptance).
None of the real agents has been run as her brain on a real machine yet; each needs that before it is called verified.

## Adding an agent

1. Add an entry to `catalog.ts`. If cc-switch already supports the agent, match its entry. If it speaks ACP, add its
   `acp` arguments from the ACP registry and it can be her brain without an adapter.
2. Record a real session into `tests/fixtures/agents/` with `scripts/record-agent.mjs`. The script removes personal
   details. If you can't record one, write a synthetic sample from the public protocol.
3. Write the decoder, and replay the sample with `tests/agents-decoders.test.ts`.
4. Add the flag mapping in `launch.ts` and a case in `tests/agents-launch.test.ts`.
5. Run `tests/host-delegation.test.ts`, which uses a fake agent. With the real CLI installed, also run
   `ANNA_REAL_AGENTS=<id> pnpm test tests/agents-real.test.ts`.
