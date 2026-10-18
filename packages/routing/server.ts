import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ChatReasoning } from './codex-chat'
import type { Json } from './json'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import zlib from 'node:zlib'
import { anthropicErrorType, anthropicToChat, chatToAnthropic, wantsReasoningReplay } from './claude-chat'
import { chatStreamToAnthropic } from './claude-chat-stream'
import { chatCompletionToResponse, chatErrorToResponseError, injectIncludeUsage, responsesToChat, toolContextFrom } from './codex-chat'
import { chatStreamToResponses } from './codex-chat-stream'

/** Claude Code's model tiers, each the provider's model it maps to (its `ANTHROPIC_*_MODEL` settings). */
export interface ClaudeModels { default?: string, haiku?: string, sonnet?: string, opus?: string, fable?: string }

/** Where one route sends an agent's requests: a Chat Completions provider. */
export interface ChatRoute {
  /** The agent on the other side: Codex speaks Responses, Claude Code Anthropic Messages. Default `codex`. */
  client?: 'codex' | 'claude'
  /** The provider's name, for the request records. */
  label?: string
  /** The provider's base URL (`…/v1`), or its full `…/chat/completions` endpoint. */
  baseUrl: string
  key?: string
  reasoning?: ChatReasoning
  /** Model → the reasoning levels it accepts (for providers that clamp per model). */
  effortLevels?: Record<string, string[]>
  /** claude: how Claude Code's model names map to the provider's. */
  models?: ClaudeModels
}

export interface RouteHandle {
  /** The agent's base URL for this route (Codex's `base_url`, Claude Code's `ANTHROPIC_BASE_URL`). */
  baseUrl: string
  /** What the agent sends as its key. It opens this route and nothing else, and stops working on `close`. */
  token: string
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
  /** How a stream ended when it didn't complete (`incomplete`, `failed`). */
  outcome?: string
}

export interface RoutingServer {
  url: string
  open: (route: ChatRoute) => RouteHandle
  /** The latest requests, oldest first. */
  records: () => RouteRecord[]
  close: () => Promise<void>
}

/** Request bodies carry whole conversations, images included. */
const maxBody = 100 * 1024 * 1024
const codexPath = '/codex/v1'
const claudePath = '/claude'
const keptRecords = 500

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex')

/**
 * The provider's Chat endpoint, by each agent's convention for base URLs (as cc-switch builds it): Codex's include the
 * version (`…/v1` → `…/v1/chat/completions`), Claude Code's don't (`…` → `…/v1/chat/completions`, a doubled `/v1/v1`
 * collapsed). A base URL that already is the endpoint stays as it is.
 */
export function chatEndpoint(baseUrl: string, client: 'codex' | 'claude' = 'codex') {
  const [path, query] = baseUrl.trim().split(/\?(.*)/s, 2) as [string, string | undefined]
  const base = path.replace(/\/+$/, '')
  const endpoint = /\/chat\/completions$/i.test(base) ? base : client === 'claude' ? `${base}/v1/chat/completions`.replace(/\/v1\/v1(?=\/|$)/g, '/v1') : `${base}/chat/completions`
  return `${endpoint}${query ? `?${query}` : ''}`
}

function sendJson(response: ServerResponse, status: number, body: Json, headers: Record<string, string> = {}) {
  if (response.headersSent)
    return response.end()
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}
const errorBody = (message: string, type: string) => ({ error: { message, type, code: null, param: null } })
/** An error in the agent's own format: Responses' for Codex, Anthropic's for Claude Code. */
function sendError(response: ServerResponse, client: 'codex' | 'claude', status: number, message: string, type: string, headers: Record<string, string> = {}) {
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

/**
 * Anna's local routing service: Codex speaks Responses to it and Claude Code Anthropic Messages, and it speaks Chat
 * Completions to the provider, so a provider with only a Chat endpoint can still be their brain. It listens on
 * 127.0.0.1. Each run gets its own route and token; the real key stays here and never reaches the agent's process.
 */
export async function startRouting(): Promise<RoutingServer> {
  const routes = new Map<string, ChatRoute>()
  const kept: RouteRecord[] = []
  const record = (entry: RouteRecord) => {
    kept.push(entry)
    if (kept.length > keptRecords)
      kept.shift()
  }
  const server = createServer((request, response) => {
    void handle(routes, record, request, response).catch((error) => {
      sendJson(response, 500, errorBody(error instanceof Error ? error.message : String(error), 'routing_error'))
    })
  })
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
    open(route) {
      const token = `anna-route-${randomBytes(24).toString('hex')}`
      const hash = hashOf(token)
      routes.set(hash, route)
      return { baseUrl: `${url}${route.client === 'claude' ? claudePath : codexPath}`, token, close: () => routes.delete(hash) }
    },
    records: () => [...kept],
    close: () => new Promise<void>((resolve) => {
      routes.clear()
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

let shared: Promise<RoutingServer> | undefined
/** The process's routing service, started on first use. */
export function routing() {
  shared ??= startRouting().catch((error) => {
    shared = undefined
    throw error
  })
  return shared
}

/** Usage and outcome from the terminal Responses event of a converted stream. */
function streamEnd(event: string): Pick<RouteRecord, 'usage' | 'outcome'> | undefined {
  const name = /^event: (response\.(?:completed|incomplete|failed))\n/.exec(event)?.[1]
  if (!name)
    return undefined
  const response = JSON.parse(event.slice(event.indexOf('data: ') + 6)).response
  const usage = response?.usage
  return { ...(usage ? { usage: { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cached: usage.input_tokens_details?.cached_tokens ?? 0 } } : {}), ...(name === 'response.completed' && response.status === 'completed' ? {} : { outcome: response?.status ?? name.slice(9) }) }
}

/** Anthropic usage for the records, with the prompt total as input (like the Codex side). */
function anthropicRecordUsage(usage: Json): RouteRecord['usage'] {
  const cached = usage?.cache_read_input_tokens ?? 0
  return { input: (usage?.input_tokens ?? 0) + cached + (usage?.cache_creation_input_tokens ?? 0), output: usage?.output_tokens ?? 0, cached }
}

/** Claude Code's `[1m]` suffix declares a context size to itself; providers don't know it. */
const withoutOneM = (model: string) => model.replace(/\s*\[1m\]\s*$/i, '')

/**
 * The provider's model for Claude Code's: one of the route's own models as it is, a Claude tier name (haiku, sonnet,
 * opus, fable) by tier, anything else the default. Without models, only the `[1m]` suffix goes.
 */
export function claudeModelFor(requested: string, models: ClaudeModels = {}) {
  const model = withoutOneM(requested)
  const own = Object.values(models).filter(Boolean).map(name => withoutOneM(name!))
  if (own.includes(model))
    return model
  const name = model.toLowerCase()
  const tier = name.includes('fable') ? models.fable ?? models.opus : name.includes('haiku') ? models.haiku : name.includes('opus') ? models.opus : name.includes('sonnet') ? models.sonnet : undefined
  const mapped = tier ?? models.default
  return mapped ? withoutOneM(mapped) : model
}

async function handle(routes: Map<string, ChatRoute>, record: (entry: RouteRecord) => void, request: IncomingMessage, response: ServerResponse) {
  // Browsers send Origin; only the agents Anna starts may use a route. Claude Code sends its key as either header.
  const bearer = /^Bearer (.+)$/i.exec(request.headers.authorization ?? '')?.[1]?.trim()
  const apiKey = typeof request.headers['x-api-key'] === 'string' ? request.headers['x-api-key'].trim() : undefined
  const token = bearer || apiKey
  const route = !request.headers.origin && token ? routes.get(hashOf(token)) : undefined
  if (!route)
    return sendJson(response, 401, errorBody('This route is closed or the token is wrong', 'invalid_api_key'))
  const client = route.client ?? 'codex'
  const path = (request.url ?? '').split('?')[0]
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
  return client === 'claude' ? forwardClaude(route, body, record, response) : forwardCodex(route, body, record, response)
}

/** Send the converted request to the provider; the upstream stops when the agent goes away (an aborted turn). */
async function callUpstream(route: ChatRoute, client: 'codex' | 'claude', chat: Json, model: string, record: (entry: RouteRecord) => void, response: ServerResponse) {
  const stream = chat.stream === true
  const abort = new AbortController()
  response.on('close', () => abort.abort())
  const started = Date.now()
  const base = { at: new Date(started).toISOString(), ...(route.label ? { provider: route.label } : {}), model }
  try {
    const upstream = await fetch(chatEndpoint(route.baseUrl, client), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': stream ? 'text/event-stream' : 'application/json', ...(route.key ? { authorization: `Bearer ${route.key}` } : {}) },
      body: JSON.stringify(chat),
      signal: abort.signal,
    })
    return { upstream, base, latency: Date.now() - started, stream }
  }
  catch (error) {
    if (abort.signal.aborted)
      return undefined
    record({ ...base, status: 0, latency: Date.now() - started, outcome: 'unreachable' })
    sendError(response, client, 502, `Could not reach the provider: ${error instanceof Error ? (error.cause as Error | undefined)?.message ?? error.message : String(error)}`, 'upstream_unreachable')
    return undefined
  }
}

/** The provider's error in the agent's format, with its status and `retry-after` kept (the agents retry on those). */
async function relayError(upstream: Response, client: 'codex' | 'claude', response: ServerResponse) {
  const text = await upstream.text().catch(() => '')
  let parsed: Json = text || undefined
  try { parsed = JSON.parse(text) }
  catch {}
  const retryAfter = upstream.headers.get('retry-after')
  const converted = chatErrorToResponseError(parsed)
  if (client === 'claude')
    return sendError(response, client, upstream.status, converted.error.message, converted.error.type, retryAfter ? { 'retry-after': retryAfter } : {})
  sendJson(response, upstream.status, converted, retryAfter ? { 'retry-after': retryAfter } : {})
}

async function forwardCodex(route: ChatRoute, body: Json, record: (entry: RouteRecord) => void, response: ServerResponse) {
  const model = typeof body.model === 'string' ? body.model : ''
  const levels = route.effortLevels?.[model]
  const context = toolContextFrom(body)
  const chat = responsesToChat(body, route.reasoning && levels ? { ...route.reasoning, effortLevels: levels } : route.reasoning)
  injectIncludeUsage(chat)
  const call = await callUpstream(route, 'codex', chat, model, record, response)
  if (!call)
    return
  const { upstream, base, latency, stream } = call
  if (!upstream.ok) {
    record({ ...base, status: upstream.status, latency })
    return relayError(upstream, 'codex', response)
  }
  if (!stream) {
    let converted: Json
    try { converted = chatCompletionToResponse(await upstream.json(), context) }
    catch (error) {
      record({ ...base, status: upstream.status, latency, outcome: 'failed' })
      return sendJson(response, 502, errorBody(error instanceof Error ? error.message : String(error), 'upstream_invalid_response'))
    }
    record({ ...base, status: upstream.status, latency, ...streamEnd(`event: response.completed\ndata: ${JSON.stringify({ response: converted })}`) })
    return sendJson(response, 200, converted)
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive' })
  // No body converts like an empty stream: a failed response, never a silent one.
  // Node's web streams are async iterable; the DOM typings don't say so.
  let end: Pick<RouteRecord, 'usage' | 'outcome'> | undefined
  for await (const event of chatStreamToResponses((upstream.body as AsyncIterable<Uint8Array> | null) ?? emptyStream(), context)) {
    if (response.destroyed)
      break
    end = streamEnd(event) ?? end
    response.write(event)
  }
  response.end()
  record({ ...base, status: upstream.status, latency, ...(end ?? { outcome: 'aborted' }) })
}

async function forwardClaude(route: ChatRoute, body: Json, record: (entry: RouteRecord) => void, response: ServerResponse) {
  const model = claudeModelFor(typeof body.model === 'string' ? body.model : '', route.models)
  const chat = anthropicToChat({ ...body, model }, wantsReasoningReplay(model, route.baseUrl))
  injectIncludeUsage(chat)
  const call = await callUpstream(route, 'claude', chat, model, record, response)
  if (!call)
    return
  const { upstream, base, latency, stream } = call
  if (!upstream.ok) {
    record({ ...base, status: upstream.status, latency })
    return relayError(upstream, 'claude', response)
  }
  if (!stream) {
    let converted: Json
    try { converted = chatToAnthropic(await upstream.json()) }
    catch (error) {
      record({ ...base, status: upstream.status, latency, outcome: 'failed' })
      return sendError(response, 'claude', 502, error instanceof Error ? error.message : String(error), 'api_error')
    }
    record({ ...base, status: upstream.status, latency, usage: anthropicRecordUsage(converted.usage), ...(converted.stop_reason === 'max_tokens' ? { outcome: 'incomplete' } : {}) })
    return sendJson(response, 200, converted)
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive' })
  let usage: RouteRecord['usage']
  let stopReason: string | undefined
  let ending: 'stopped' | 'failed' | undefined
  for await (const event of chatStreamToAnthropic((upstream.body as AsyncIterable<Uint8Array> | null) ?? emptyStream())) {
    if (response.destroyed)
      break
    if (event.startsWith('event: message_delta\n')) {
      const delta = JSON.parse(event.slice(event.indexOf('data: ') + 6))
      usage = anthropicRecordUsage(delta.usage)
      stopReason = delta.delta?.stop_reason
    }
    else if (event.startsWith('event: message_stop\n')) {
      ending = 'stopped'
    }
    else if (event.startsWith('event: error\n')) {
      ending = 'failed'
    }
    response.write(event)
  }
  response.end()
  const outcome = ending === 'failed' ? 'failed' : !ending ? 'aborted' : stopReason === 'max_tokens' ? 'incomplete' : undefined
  record({ ...base, status: upstream.status, latency, ...(usage ? { usage } : {}), ...(outcome ? { outcome } : {}) })
}
