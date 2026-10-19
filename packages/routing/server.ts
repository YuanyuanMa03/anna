import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { BreakerStats, Client, FailoverPolicy } from './breaker'
import type { ChatReasoning, CodexToolContext } from './codex-chat'
import type { Json } from './json'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import zlib from 'node:zlib'
import { CircuitBreaker, failoverDefaults, retryableStatus } from './breaker'
import { anthropicErrorType, anthropicToChat, chatToAnthropic, wantsReasoningReplay } from './claude-chat'
import { chatStreamToAnthropic } from './claude-chat-stream'
import { chatCompletionToResponse, chatErrorToResponseError, injectIncludeUsage, responsesToChat, toolContextFrom } from './codex-chat'
import { chatStreamToResponses, takeSseBlocks } from './codex-chat-stream'

/** Claude Code's model tiers, each the provider's model it maps to (its `ANTHROPIC_*_MODEL` settings). */
export interface ClaudeModels { default?: string, haiku?: string, sonnet?: string, opus?: string, fable?: string }

/** One provider a route can send to. */
export interface Upstream {
  /** Identifies the provider for its circuit breaker (default: the label). */
  id?: string
  /** The provider's name, for the request records and failover notes. */
  label?: string
  /** `chat` (default): Chat Completions, converted. `native`: the agent's own format, passed through. */
  format?: 'chat' | 'native'
  /** The provider's base URL, or its full endpoint. */
  baseUrl: string
  key?: string
  /** native, claude: the key goes in `x-api-key` (Claude Code's `ANTHROPIC_API_KEY`) rather than as a bearer token. */
  keyHeader?: 'x-api-key' | 'authorization'
  reasoning?: ChatReasoning
  /** Model → the reasoning levels it accepts (for providers that clamp per model). */
  effortLevels?: Record<string, string[]>
  /** claude: how Claude Code's model names map to this provider's. */
  models?: ClaudeModels
  /** codex: the model this provider is asked for (Codex asks for the first provider's). */
  model?: string
  /** native, codex: the gateway rejects Codex's hosted `web_search` tool. */
  dropWebSearch?: boolean
}

/** Why a provider failed: an HTTP status, no answer in time, not reachable, or an empty stream. */
export type FailureKind = 'status' | 'timeout' | 'unreachable' | 'empty'
/** A request moved to the next provider (`to`), or ran out of them. `reason` is the detail, in English. */
export interface FailoverEvent { from: string, to?: string, kind: FailureKind, status?: number, reason: string }

/** Where one route sends an agent's requests: a provider, and the ones to try when it fails. */
export interface ChatRoute extends Upstream {
  /** The agent on the other side: Codex speaks Responses, Claude Code Anthropic Messages. Default `codex`. */
  client?: Client
  /** Tried in order when a request fails before the agent got anything. */
  backups?: Upstream[]
  /** Timeouts and retries for this route, over the agent's defaults. */
  failover?: Partial<FailoverPolicy>
  onFailover?: (event: FailoverEvent) => void
}

export interface RouteHandle {
  /** The agent's base URL for this route (Codex's `base_url`, Claude Code's `ANTHROPIC_BASE_URL`). */
  baseUrl: string
  /** What the agent sends as its key. It opens this route and nothing else, and stops working on `close`. */
  token: string
  /** Point the open route at other providers (the token stays). */
  update: (route: ChatRoute) => void
  close: () => void
}

/** One routed request, for usage statistics: never a key or a body. */
export interface RouteRecord {
  at: string
  provider?: string
  model: string
  /** The provider's HTTP status; 0 when it could not be reached. */
  status: number
  /** Until the provider answered (its headers), in ms. */
  latency: number
  usage?: { input: number, output: number, cached: number }
  /** How it ended when it didn't complete (`incomplete`, `failed`, `aborted`, `unreachable`, `timeout`). */
  outcome?: string
}

export interface RoutingServer {
  url: string
  /** A route with a new random token, or with `token` (global routing keeps one per agent across restarts). */
  open: (route: ChatRoute, token?: string) => RouteHandle
  /** Also listen on a fixed port (global routing: the agents' own configs point there); its base URL. */
  listen: (port: number) => Promise<string>
  /** Failover settings for one agent, over the defaults. */
  configure: (client: Client, policy: Partial<FailoverPolicy>) => void
  /** The latest requests, oldest first. */
  records: () => RouteRecord[]
  /** Each provider's circuit breaker, by `client:id`; only providers that took part in a failover line-up. */
  health: () => Record<string, BreakerStats>
  resetHealth: (key: string) => void
  close: () => Promise<void>
}

/** Request bodies carry whole conversations, images included. */
const maxBody = 100 * 1024 * 1024
const codexPath = '/codex/v1'
const claudePath = '/claude'
const keptRecords = 500

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex')
const nameOf = (upstream: Upstream) => upstream.label ?? upstream.id ?? upstream.baseUrl
const breakerKey = (client: Client, upstream: Upstream) => `${client}:${upstream.id ?? nameOf(upstream)}`

function splitQuery(url: string): [string, string | undefined] {
  const [path, query] = url.trim().split(/\?(.*)/s, 2) as [string, string | undefined]
  return [path.replace(/\/+$/, ''), query || undefined]
}
const withQuery = (path: string, query?: string) => query ? `${path}?${query}` : path

/**
 * The provider's Chat endpoint, by each agent's convention for base URLs (as cc-switch builds it): Codex's include the
 * version (`…/v1` → `…/v1/chat/completions`), Claude Code's don't (`…` → `…/v1/chat/completions`, a doubled `/v1/v1`
 * collapsed). A base URL that already is the endpoint stays as it is.
 */
export function chatEndpoint(baseUrl: string, client: Client = 'codex') {
  const [base, query] = splitQuery(baseUrl)
  const endpoint = /\/chat\/completions$/i.test(base) ? base : client === 'claude' ? `${base}/v1/chat/completions`.replace(/\/v1\/v1(?=\/|$)/g, '/v1') : `${base}/chat/completions`
  return withQuery(endpoint, query)
}

/** The agent's own endpoint at a native provider: `…/responses` for Codex, `…/v1/messages` for Claude Code. */
export function nativeEndpoint(baseUrl: string, client: Client, agentQuery?: string) {
  const [base, query] = splitQuery(baseUrl)
  const endpoint = client === 'codex'
    ? (/\/responses$/i.test(base) ? base : `${base}/responses`)
    : (/\/v1\/messages$/i.test(base) ? base : `${base}/v1/messages`.replace(/\/v1\/v1(?=\/|$)/g, '/v1'))
  return withQuery(endpoint, [query, agentQuery].filter(Boolean).join('&') || undefined)
}

function sendJson(response: ServerResponse, status: number, body: Json, headers: Record<string, string> = {}) {
  if (response.headersSent)
    return response.end()
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}
const errorBody = (message: string, type: string) => ({ error: { message, type, code: null, param: null } })
/** An error in the agent's own format: Responses' for Codex, Anthropic's for Claude Code. */
function sendError(response: ServerResponse, client: Client, status: number, message: string, type: string, headers: Record<string, string> = {}) {
  sendJson(response, status, client === 'claude' ? { type: 'error', error: { type: anthropicErrorType(status), message } } : errorBody(message, type), headers)
}
async function* emptyStream(): AsyncGenerator<Uint8Array> {}

const decoders: Record<string, ((buffer: Buffer) => Buffer) | undefined> = {
  gzip: zlib.gunzipSync,
  deflate: zlib.inflateSync,
  br: zlib.brotliDecompressSync,
  zstd: (zlib as { zstdDecompressSync?: (buffer: Buffer) => Buffer }).zstdDecompressSync,
}

function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBody) {
        resolve(undefined)
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', () => resolve(undefined))
  })
}

interface Service {
  record: (entry: RouteRecord) => void
  breaker: (client: Client, upstream: Upstream) => CircuitBreaker
  policy: (client: Client) => FailoverPolicy
}

/**
 * Anna's local routing service. Codex speaks Responses to it and Claude Code Anthropic Messages; it speaks Chat
 * Completions to a provider that has only that, and passes the agent's own format through to one that has it. A route
 * can hold backups, tried in order when a request fails before the agent got anything, with a circuit breaker per
 * provider. It listens on 127.0.0.1; each run gets its own route and token, and the real keys never leave this process.
 */
export async function startRouting(): Promise<RoutingServer> {
  const routes = new Map<string, ChatRoute>()
  const kept: RouteRecord[] = []
  const breakers = new Map<string, CircuitBreaker>()
  const overrides: Partial<Record<Client, Partial<FailoverPolicy>>> = {}
  const service: Service = {
    record(entry) {
      kept.push(entry)
      if (kept.length > keptRecords)
        kept.shift()
    },
    breaker(client, upstream) {
      const key = breakerKey(client, upstream)
      let breaker = breakers.get(key)
      if (!breaker) {
        breaker = new CircuitBreaker(() => service.policy(client))
        breakers.set(key, breaker)
      }
      return breaker
    },
    policy: client => ({ ...failoverDefaults[client], ...overrides[client] }),
  }
  const listener = (request: IncomingMessage, response: ServerResponse) => {
    void handle(routes, service, request, response).catch((error) => {
      sendJson(response, 500, errorBody(error instanceof Error ? error.message : String(error), 'routing_error'))
    })
  }
  const server = createServer(listener)
  /** The fixed-port listener, once global routing asked for one. */
  let fixed: { port: number, server: ReturnType<typeof createServer> } | undefined
  // A stream from a reasoning model can run for many minutes.
  server.requestTimeout = 0
  server.headersTimeout = 60_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  server.unref()
  const { port } = server.address() as { port: number }
  const url = `http://127.0.0.1:${port}`
  return {
    url,
    open(route, given) {
      const token = given ?? `anna-route-${randomBytes(24).toString('hex')}`
      const hash = hashOf(token)
      routes.set(hash, route)
      return { baseUrl: `${url}${route.client === 'claude' ? claudePath : codexPath}`, token, update: next => void (routes.has(hash) && routes.set(hash, next)), close: () => routes.delete(hash) }
    },
    async listen(port) {
      if (fixed && fixed.port !== port) {
        fixed.server.closeAllConnections()
        await new Promise(resolve => fixed!.server.close(resolve))
        fixed = undefined
      }
      if (!fixed) {
        const extra = createServer(listener)
        extra.requestTimeout = 0
        extra.headersTimeout = 60_000
        await new Promise<void>((resolve, reject) => {
          extra.once('error', reject)
          extra.listen(port, '127.0.0.1', () => resolve())
        })
        extra.unref()
        fixed = { port, server: extra }
      }
      // Port 0 (tests) means any free port: report the one it got.
      return `http://127.0.0.1:${(fixed.server.address() as { port: number }).port}`
    },
    configure(client, policy) { overrides[client] = policy },
    records: () => [...kept],
    health: () => Object.fromEntries([...breakers].map(([key, breaker]) => [key, breaker.stats()])),
    resetHealth: key => breakers.get(key)?.reset(),
    close: () => new Promise<void>((resolve) => {
      routes.clear()
      fixed?.server.closeAllConnections()
      fixed?.server.close()
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

let shared: Promise<RoutingServer> | undefined
let current: RoutingServer | undefined
/** The process's routing service, started on first use. */
export function routing() {
  shared ??= startRouting().then((server) => {
    current = server
    return server
  }, (error) => {
    shared = undefined
    throw error
  })
  return shared
}
/** The process's routing service if a run has started it (for health reports, without starting it). */
export const routingIfStarted = () => current

/** Usage and outcome from the terminal Responses event of a converted stream. */
function streamEnd(event: string): Pick<RouteRecord, 'usage' | 'outcome'> | undefined {
  const name = /^event: (response\.(?:completed|incomplete|failed))\n/.exec(event)?.[1]
  if (!name)
    return undefined
  const response = JSON.parse(event.slice(event.indexOf('data: ') + 6)).response
  return responseEnd(response, name)
}
function responseEnd(response: Json, name = 'response.completed'): Pick<RouteRecord, 'usage' | 'outcome'> {
  const usage = response?.usage
  return { ...(usage ? { usage: { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cached: usage.input_tokens_details?.cached_tokens ?? 0 } } : {}), ...(name === 'response.completed' && response?.status === 'completed' ? {} : { outcome: response?.status ?? name.slice(9) }) }
}

/** Anthropic usage for the records, with the prompt total as input (like the Codex side). */
function anthropicRecordUsage(usage: Json): RouteRecord['usage'] {
  const cached = usage?.cache_read_input_tokens ?? 0
  return { input: (usage?.input_tokens ?? 0) + cached + (usage?.cache_creation_input_tokens ?? 0), output: usage?.output_tokens ?? 0, cached }
}

/** Follows an Anthropic event stream for the records: usage, stop reason, and how it ended. */
class AnthropicEnd {
  usage?: RouteRecord['usage']
  private stopReason?: string
  private ending?: 'stopped' | 'failed'
  see(event: string) {
    if (event.startsWith('event: message_delta\n')) {
      const delta = JSON.parse(event.slice(event.indexOf('data: ') + 6))
      this.usage = anthropicRecordUsage(delta.usage)
      this.stopReason = delta.delta?.stop_reason
    }
    else if (event.startsWith('event: message_stop\n')) {
      this.ending = 'stopped'
    }
    else if (event.startsWith('event: error\n')) {
      this.ending = 'failed'
    }
  }

  result(): Pick<RouteRecord, 'usage' | 'outcome'> {
    const outcome = this.ending === 'failed' ? 'failed' : !this.ending ? 'aborted' : this.stopReason === 'max_tokens' ? 'incomplete' : undefined
    return { ...(this.usage ? { usage: this.usage } : {}), ...(outcome ? { outcome } : {}) }
  }
}

/** Claude Code's `[1m]` suffix declares a context size to itself; providers don't know it. */
const withoutOneM = (model: string) => model.replace(/\s*\[1m\]\s*$/i, '')

/**
 * The provider's model for Claude Code's: one of the provider's own models as it is; one the first provider of the
 * route names for a tier, this provider's model for that tier; a Claude tier name (haiku, sonnet, opus, fable) by
 * tier; anything else the default. Without models, only the `[1m]` suffix goes.
 */
export function claudeModelFor(requested: string, models: ClaudeModels = {}, first?: ClaudeModels) {
  const model = withoutOneM(requested)
  const own = Object.values(models).filter(Boolean).map(name => withoutOneM(name!))
  if (own.includes(model))
    return model
  const tierOfFirst = first && (Object.entries(first) as [keyof ClaudeModels, string | undefined][]).find(([, name]) => name && withoutOneM(name) === model)?.[0]
  const name = model.toLowerCase()
  const tier = tierOfFirst ? models[tierOfFirst] : name.includes('fable') ? models.fable ?? models.opus : name.includes('haiku') ? models.haiku : name.includes('opus') ? models.opus : name.includes('sonnet') ? models.sonnet : undefined
  const mapped = tier ?? models.default
  return mapped ? withoutOneM(mapped) : model
}

async function handle(routes: Map<string, ChatRoute>, service: Service, request: IncomingMessage, response: ServerResponse) {
  // Browsers send Origin; only the agents Anna starts may use a route. Claude Code sends its key as either header.
  const bearer = /^Bearer (.+)$/i.exec(request.headers.authorization ?? '')?.[1]?.trim()
  const apiKey = typeof request.headers['x-api-key'] === 'string' ? request.headers['x-api-key'].trim() : undefined
  const token = bearer || apiKey
  const route = !request.headers.origin && token ? routes.get(hashOf(token)) : undefined
  if (!route)
    return sendJson(response, 401, errorBody('This route is closed or the token is wrong', 'invalid_api_key'))
  const client = route.client ?? 'codex'
  const [path, query] = splitQuery(request.url ?? '')
  if (request.method !== 'POST' || path !== (client === 'claude' ? `${claudePath}/v1/messages` : `${codexPath}/responses`))
    return sendError(response, client, 404, `Anna's routing does not serve ${request.method} ${path}`, 'not_found')
  let raw = await readBody(request)
  if (!raw)
    return sendError(response, client, 413, 'Request body too large', 'invalid_request_error')
  const encoding = String(request.headers['content-encoding'] ?? '').trim().toLowerCase()
  if (encoding && encoding !== 'identity') {
    const decode = decoders[encoding]
    if (!decode)
      return sendError(response, client, 415, `Unsupported content-encoding: ${encoding}`, 'invalid_request_error')
    try { raw = decode(raw) }
    catch { return sendError(response, client, 400, `Could not decode the ${encoding} request body`, 'invalid_request_error') }
  }
  let body: Json
  try { body = JSON.parse(raw.toString('utf8')) }
  catch { return sendError(response, client, 400, 'Request body is not JSON', 'invalid_request_error') }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return sendError(response, client, 400, 'Request body must be a JSON object', 'invalid_request_error')
  return forward(route, client, body, { query, headers: request.headers }, service, response)
}

/** What one attempt sends, and how to turn the provider's answer into the agent's. */
interface Plan {
  upstream: Upstream
  url: string
  headers: Record<string, string>
  payload: Json
  stream: boolean
  model: string
  /** codex, chat: the request's tools, to turn the reply's tool calls back into Codex's. */
  context?: CodexToolContext
}

/**
 * The agent's own headers that go along: its user agent everywhere (coding plans check who is calling), and for a
 * provider in the agent's own format the protocol and client headers it would have sent itself. Never its key.
 */
const forwarded: Record<Client, string[]> = { claude: ['anthropic-version', 'anthropic-beta', 'x-app'], codex: ['originator', 'version', 'openai-beta', 'session_id'] }
function agentHeaders(client: Client, native: boolean, given: IncomingHttpHeaders) {
  const out: Record<string, string> = {}
  for (const name of ['user-agent', ...(native ? forwarded[client] : [])]) {
    const value = given[name]
    if (typeof value === 'string' && value && !/[\r\n]/.test(value))
      out[name] = value
  }
  return out
}

function plan(route: ChatRoute, client: Client, upstream: Upstream, body: Json, agent: { query?: string, headers: IncomingHttpHeaders }): Plan {
  const requested = typeof body.model === 'string' ? body.model : ''
  const model = client === 'claude' ? claudeModelFor(requested, upstream.models, route.models) : upstream.model ?? requested
  const native = upstream.format === 'native'
  const headers: Record<string, string> = { ...agentHeaders(client, native, agent.headers), 'content-type': 'application/json' }
  if (native) {
    const payload: Json = { ...body, model }
    if (client === 'codex' && upstream.dropWebSearch && Array.isArray(payload.tools))
      payload.tools = payload.tools.filter((tool: Json) => !String(tool?.type ?? '').startsWith('web_search'))
    if (client === 'claude')
      headers['anthropic-version'] ??= '2023-06-01'
    if (upstream.key)
      headers[upstream.keyHeader === 'x-api-key' ? 'x-api-key' : 'authorization'] = upstream.keyHeader === 'x-api-key' ? upstream.key : `Bearer ${upstream.key}`
    return { upstream, url: nativeEndpoint(upstream.baseUrl, client, client === 'claude' ? agent.query : undefined), headers: { ...headers, accept: body.stream === true ? 'text/event-stream' : 'application/json' }, payload, stream: body.stream === true, model }
  }
  let payload: Json
  let context: CodexToolContext | undefined
  if (client === 'claude') {
    payload = anthropicToChat({ ...body, model }, wantsReasoningReplay(model, upstream.baseUrl))
  }
  else {
    const levels = upstream.effortLevels?.[model]
    context = toolContextFrom(body)
    payload = responsesToChat({ ...body, model }, upstream.reasoning && levels ? { ...upstream.reasoning, effortLevels: levels } : upstream.reasoning)
  }
  injectIncludeUsage(payload)
  if (upstream.key)
    headers.authorization = `Bearer ${upstream.key}`
  const stream = payload.stream === true
  return { upstream, url: chatEndpoint(upstream.baseUrl, client), headers: { ...headers, accept: stream ? 'text/event-stream' : 'application/json' }, payload, stream, model, context }
}

type Attempt
  = | { ok: true, response: Response, chunks?: AsyncIterable<Uint8Array>, text?: string, latency: number }
    | { ok: false, retry: boolean, kind: FailureKind, reason: string, status: number, latency: number, response?: Response, text?: string, aborted?: boolean }

/** Reads a stream, failing when it stays silent too long (only with somewhere else to go). */
async function* withIdleTimeout(first: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>, idleMs: number | undefined, stop: () => void): AsyncGenerator<Uint8Array> {
  yield first
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const next = idleMs
        ? await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no data for ${idleMs / 1000} s`)), idleMs) })]).finally(() => clearTimeout(timer))
        : await reader.read()
      if (next.done)
        return
      yield next.value
    }
  }
  catch (error) {
    stop()
    throw error
  }
  finally {
    reader.releaseLock()
  }
}

/**
 * One try at one provider. With backups, nothing reaches the agent until the provider has answered and (for a
 * stream) sent its first bytes in time, so a failure up to then can still move to the next provider.
 */
async function attempt(target: Plan, policy: FailoverPolicy | undefined, agentGone: AbortSignal): Promise<Attempt> {
  const controller = new AbortController()
  const stop = () => controller.abort()
  agentGone.addEventListener('abort', stop, { once: true })
  const started = Date.now()
  let timedOut = false
  const deadline = policy && setTimeout(() => {
    timedOut = true
    controller.abort()
  }, (target.stream ? policy.firstByteTimeout : policy.requestTimeout) * 1000)
  const failed = (kind: FailureKind, reason: string, extra: Partial<Attempt> = {}): Attempt => ({ ok: false, retry: true, kind, reason, status: 0, latency: Date.now() - started, aborted: agentGone.aborted, ...extra } as Attempt)
  try {
    const response = await fetch(target.url, { method: 'POST', headers: target.headers, body: JSON.stringify(target.payload), signal: controller.signal })
    const latency = Date.now() - started
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { ok: false, retry: retryableStatus(response.status), kind: 'status', reason: `HTTP ${response.status}`, status: response.status, latency, response, text }
    }
    // A whole answer is read here, still within the time limit; a failure on the way can move on like any other.
    if (!target.stream)
      return { ok: true, response, text: await response.text(), latency }
    if (!response.body)
      return { ok: true, response, chunks: emptyStream(), latency }
    if (!policy)
      return { ok: true, response, chunks: response.body as unknown as AsyncIterable<Uint8Array>, latency }
    const reader = response.body.getReader()
    const first = await reader.read()
    if (first.done)
      return failed('empty', 'the provider sent an empty stream', { status: response.status, latency })
    return { ok: true, response, chunks: withIdleTimeout(first.value, reader, policy.idleTimeout * 1000, stop), latency }
  }
  catch (error) {
    if (agentGone.aborted)
      return failed('unreachable', 'the agent went away')
    if (timedOut)
      return failed('timeout', target.stream ? `no first byte within ${policy!.firstByteTimeout} s` : `no answer within ${policy!.requestTimeout} s`)
    return failed('unreachable', `could not reach it: ${error instanceof Error ? (error.cause as Error | undefined)?.message ?? error.message : String(error)}`)
  }
  finally {
    // The link to the agent stays: when it goes away mid-stream, the provider's request stops too.
    clearTimeout(deadline)
  }
}

/**
 * Send the request to the route's providers in order until one answers. Without backups there is one try, with no
 * timeouts and no breaker, exactly as before. With backups, a provider whose breaker is open is skipped, and a
 * failure before the agent got anything (unreachable, a timeout, an empty stream, 401/403/404/408/429/5xx…) moves
 * on; once the agent has bytes, an error is the agent's to handle, and two providers' output is never spliced.
 */
async function forward(route: ChatRoute, client: Client, body: Json, agent: { query?: string, headers: IncomingHttpHeaders }, service: Service, response: ServerResponse) {
  const upstreams = [route, ...(route.backups ?? [])]
  const failover = upstreams.length > 1
  const policy = failover ? { ...service.policy(client), ...route.failover } : undefined
  const line = failover ? upstreams.filter(upstream => service.breaker(client, upstream).available()) : upstreams
  if (!line.length)
    return sendError(response, client, 503, 'Every provider for this agent is paused after repeated failures; try again in a minute', 'overloaded_error')
  const agentGone = new AbortController()
  response.on('close', () => agentGone.abort())
  let last: { label: string, result: Extract<Attempt, { ok: false }>, upstream: Upstream } | undefined
  let tries = 0
  for (const upstream of line) {
    if (policy && tries > policy.maxRetries)
      break
    const breaker = failover ? service.breaker(client, upstream) : undefined
    const slot = breaker?.allow() ?? { allowed: true, probe: false }
    if (!slot.allowed)
      continue
    if (last)
      route.onFailover?.(failoverEvent(last.label, last.result, nameOf(upstream)))
    tries++
    const target = plan(route, client, upstream, body, agent)
    const base = { at: new Date().toISOString(), ...(upstream.label ? { provider: upstream.label } : {}), model: target.model }
    const result = await attempt(target, policy, agentGone.signal)
    if (result.ok) {
      breaker?.success(slot.probe)
      return deliver(client, target, result, base, service, response)
    }
    if (result.aborted) {
      breaker?.neutral(slot.probe)
      return
    }
    service.record({ ...base, status: result.status, latency: result.latency, ...(result.kind === 'status' ? {} : { outcome: result.kind }) })
    if (!result.retry) {
      breaker?.neutral(slot.probe)
      return relayFailure(client, upstream, result, response)
    }
    breaker?.failure(slot.probe)
    last = { label: nameOf(upstream), result, upstream }
  }
  if (!last)
    return sendError(response, client, 503, 'Every provider for this agent is paused after repeated failures; try again in a minute', 'overloaded_error')
  if (failover)
    route.onFailover?.(failoverEvent(last.label, last.result))
  return relayFailure(client, last.upstream, last.result, response)
}

function failoverEvent(from: string, result: Extract<Attempt, { ok: false }>, to?: string): FailoverEvent {
  return { from, ...(to ? { to } : {}), kind: result.kind, ...(result.kind === 'status' ? { status: result.status } : {}), reason: result.reason }
}

/** The provider's error in the agent's format, with its status and `retry-after` kept (the agents retry on those). */
function relayFailure(client: Client, upstream: Upstream, result: Extract<Attempt, { ok: false }>, response: ServerResponse) {
  if (!result.response)
    return sendError(response, client, 502, `${nameOf(upstream)}: ${result.reason}`, 'upstream_unreachable')
  const retryAfter = result.response.headers.get('retry-after')
  const headers: Record<string, string> = retryAfter ? { 'retry-after': retryAfter } : {}
  let parsed: Json = result.text || undefined
  try { parsed = JSON.parse(result.text ?? '') }
  catch {}
  // A native provider's error is already in the agent's format.
  if (upstream.format === 'native' && parsed && typeof parsed === 'object')
    return sendJson(response, result.status, parsed, headers)
  const converted = chatErrorToResponseError(parsed)
  if (client === 'claude')
    return sendError(response, client, result.status, converted.error.message, converted.error.type, headers)
  sendJson(response, result.status, converted, headers)
}

async function deliver(client: Client, target: Plan, result: Extract<Attempt, { ok: true }>, base: Pick<RouteRecord, 'at' | 'provider' | 'model'>, service: Service, response: ServerResponse) {
  const record = (end: Pick<RouteRecord, 'usage' | 'outcome'> = {}) => service.record({ ...base, status: result.response.status, latency: result.latency, ...end })
  const native = target.upstream.format === 'native'
  if (!target.stream) {
    let converted: Json
    try {
      const json = JSON.parse(result.text ?? '')
      converted = native ? json : client === 'claude' ? chatToAnthropic(json) : chatCompletionToResponse(json, target.context)
    }
    catch (error) {
      record({ outcome: 'failed' })
      return sendError(response, client, 502, error instanceof Error ? error.message : String(error), 'upstream_invalid_response')
    }
    record(client === 'claude' ? { usage: anthropicRecordUsage(converted.usage), ...(converted.stop_reason === 'max_tokens' ? { outcome: 'incomplete' } : {}) } : responseEnd(converted))
    return sendJson(response, 200, converted)
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive' })
  const chunks = result.chunks ?? emptyStream()
  const anthropic = new AnthropicEnd()
  let end: Pick<RouteRecord, 'usage' | 'outcome'> | undefined
  const see = (event: string) => {
    if (client === 'claude')
      anthropic.see(event)
    else end = streamEnd(event) ?? end
  }
  if (native) {
    // Passed through byte for byte; the events are only read for the records.
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for await (const bytes of chunks) {
        if (response.destroyed)
          break
        response.write(bytes)
        const [blocks, rest] = takeSseBlocks(buffer + decoder.decode(bytes, { stream: true }))
        buffer = rest
        for (const block of blocks) see(`${block}\n\n`)
      }
    }
    catch {}
  }
  else {
    const events = client === 'claude' ? chatStreamToAnthropic(chunks) : chatStreamToResponses(chunks, target.context!)
    for await (const event of events) {
      if (response.destroyed)
        break
      see(event)
      response.write(event)
    }
  }
  response.end()
  record(client === 'claude' ? anthropic.result() : end ?? { outcome: 'aborted' })
}
