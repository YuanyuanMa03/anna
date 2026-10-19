# Spec: local routing (cc-switch in Anna, phase 2)

> Status: agreed 2026-10-18; P2a (Codex → Chat Completions), P2b (Claude Code → Chat Completions), P2c (failover)
> and P2d (global routing) built. This document is the source of truth; change it before changing the
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

### P2d as built

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
  The replaced fields and the original file are saved before the first write, so after a crash the next start renews
  the takeover (still switched on) or gives the config back (switched off).
- **The token** is one per agent, kept with the keys in the encrypted store, so the config stays valid across
  restarts. Global routing and the direct "应用到全局" exclude each other.
- **Failover settings** (P2c's numbers) can be changed per agent under "换用备用的超时与暂停": retries, first-byte
  and idle timeouts, failures before a pause, and the pause; "恢复默认" goes back to cc-switch's defaults.
- Tests and Anna's scripted desktop run use config folders inside their data folder and a random port, never `~`.

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

### P2b as built

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

## 5. Failover (P2c)

- Per agent, a queue of providers; a request that fails before its first byte reaches the agent (connection error,
  5xx, 429, first-byte timeout) moves to the next. Once streaming has started, an error is passed to the agent, which
  has its own retries; output from two providers is never spliced.
- A circuit breaker per provider (closed, open, half-open) with cc-switch's defaults (more lenient for Claude Code),
  adjustable; health badges on provider cards.
- When a failover happens during a task, the stage says so, and `anna_providers` reports the queue and health.

### P2c as built

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

## 6. Aggregation (P2e)

Several providers' models in one model list, requests routed by model name (prefix `anna-`). Mainly for global
routing, where the user picks models in the agent itself; Anna's runs already pick a provider per run
(`@codex/Kimi`).

## 7. Verification

- Unit: request and stream conversion against the ported fixtures; token checks; failover and breaker states.
- Real agents without keys: a fake upstream that speaks Chat Completions, with the real Codex (P2a) and Claude Code
  (P2b) pointed at the routing service, finishing a turn with tool calls. P2a: `ANNA_REAL_AGENTS=codex pnpm vitest run
  tests/agents-real.test.ts -t "local routing"` (Codex 0.160: a freeform `apply_patch` call, and Codex as Anna's brain
  calling `anna_memory`). P2b: `ANNA_REAL_AGENTS=claude … -t "real Claude Code through"` (Claude Code 2.1.302: its
  `Write` tool, and Claude Code as Anna's brain calling `anna_memory`). P2c: `ANNA_REAL_AGENTS=codex,claude … -t
  "failing over"`: the provider in use answers 503, the backup is a provider in the agent's own format (a second Anna
  route in front of the scripted upstream), and both agents finish the edit without seeing the 503. P2d:
  `… -t "global routing"`: the real `codex exec` and `claude -p`, run with their own (taken-over) config folder and no
  Anna variables in the environment, answer through the route.
- With a key the user provides: one real provider per conversion. P2a: DeepSeek's Chat API (`deepseek-flash`) with
  `ANNA_REAL_CHAT_KEY` (`-t "real Chat provider"`): a delegated file edit over six turns, all 200, prompt cache hits
  from the second turn; and Codex as Anna's brain saving a memory with `anna_memory`. P2b, the same key and model with
  Claude Code: a delegated file edit in two turns (21120 of 21353 input tokens cached on the second) and the brain
  saving a memory.
