# Spec: local routing (cc-switch in Anna, phase 2)

> Status: agreed 2026-10-18; P2a (Codex → Chat Completions for Anna's own runs) built. This document is the source of truth; change it before changing the
> behavior. Built after cc-switch's local routing (https://github.com/farion1231/cc-switch, MIT), whose conversion code
> and test cases are ported.

## 1. What it is for

A coding agent speaks one API format: Claude Code speaks Anthropic Messages, Codex speaks OpenAI Responses, Gemini CLI
speaks Gemini's own. Many providers speak only OpenAI Chat Completions. Local routing sits between the agent and the
provider, converts the format, and can move a request to another provider when one fails.

## 2. Two layers

- **Anna's own runs (first).** Delegations and Claude Code / Codex as Anna's brain are started by Anna, so the routing
  address is injected at launch, like a provider today. No config file changes; nothing to undo when Anna quits.
- **Global routing (P2d, opt-in per agent).** Like cc-switch, the agent's own config points at Anna, so the CLIs the
  user runs in a terminal are routed too. Needs Anna running; the original config is written back on quit and repaired
  on the next start after a crash.

## 3. The routing service

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

## 4. Format conversion

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

### P2a as built

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
- Applying such a provider globally is refused with the reason until P2d.

## 5. Failover (P2c)

- Per agent, a queue of providers; a request that fails before its first byte reaches the agent (connection error,
  5xx, 429, first-byte timeout) moves to the next. Once streaming has started, an error is passed to the agent, which
  has its own retries; output from two providers is never spliced.
- A circuit breaker per provider (closed, open, half-open) with cc-switch's defaults (more lenient for Claude Code),
  adjustable; health badges on provider cards.
- When a failover happens during a task, the stage says so, and `anna_providers` reports the queue and health.

## 6. Aggregation (P2e)

Several providers' models in one model list, requests routed by model name (prefix `anna-`). Mainly for global
routing, where the user picks models in the agent itself; Anna's runs already pick a provider per run
(`@codex/Kimi`).

## 7. Verification

- Unit: request and stream conversion against the ported fixtures; token checks; failover and breaker states.
- Real agents without keys: a fake upstream that speaks Chat Completions, with the real Codex (P2a) and Claude Code
  (P2b) pointed at the routing service, finishing a turn with tool calls. P2a: `ANNA_REAL_AGENTS=codex pnpm vitest run
  tests/agents-real.test.ts -t "local routing"` (Codex 0.160: a freeform `apply_patch` call, and Codex as Anna's brain
  calling `anna_memory`).
- With a key the user provides: one real provider per conversion.
