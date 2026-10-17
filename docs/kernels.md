# Kernels and external agents

Anna uses other agents in two ways. Both are built on the adapters in `packages/agents/`.

- **Delegation**: pi is Anna's brain and the other agents are her colleagues. Mention one with `@claude <task>`, or let
  Anna decide through the `anna_delegate` tool. Implemented in `anna-host/delegator.ts`.
- **Brain swap**: in **Model & Settings**, replace Anna's brain with Claude Code or Codex. Implemented in
  `kernels/external/kernel.ts`.

## Adapter parts

| File | Responsibility |
|---|---|
| `agents/catalog.ts` | The same 10 apps as cc-switch: detection, config folders, install and upgrade commands, capability tier |
| `agents/detect.ts` | Searches `PATH` plus nvm, fnm, volta, mise, Homebrew and npm global folders; reads the version; runs each agent's own login-status command |
| `agents/launch.ts` | Maps Anna's mode, provider, session and persona to each agent's command-line flags |
| `agents/adapters/*` | Decodes each agent's headless output line by line into Anna's `KernelEvent`s and writes approval replies |
| `agents/runner.ts` | Starts the process, decodes it, sends approval requests through Anna's permission gate, handles interrupts |
| `agents/providers.ts`, `global.ts` | Provider presets (from cc-switch), per-delegation injection, global apply and restore |

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

## Adding an agent

1. Add an entry to `catalog.ts`. If cc-switch already supports the agent, match its entry.
2. Record a real session into `tests/fixtures/agents/` with `scripts/record-agent.mjs`. The script removes personal
   details. If you can't record one, write a synthetic sample from the public protocol.
3. Write the decoder, and replay the sample with `tests/agents-decoders.test.ts`.
4. Add the flag mapping in `launch.ts` and a case in `tests/agents-launch.test.ts`.
5. Run `tests/host-delegation.test.ts`, which uses a fake agent. With the real CLI installed, also run
   `ANNA_REAL_AGENTS=<id> pnpm test tests/agents-real.test.ts`.
