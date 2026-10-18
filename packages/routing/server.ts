import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ChatReasoning } from './codex-chat'
import type { Json } from './json'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import zlib from 'node:zlib'
import { chatCompletionToResponse, chatErrorToResponseError, injectIncludeUsage, responsesToChat, toolContextFrom } from './codex-chat'
import { chatStreamToResponses } from './codex-chat-stream'

/** Where one route sends Codex's requests: a Chat Completions provider. */
export interface ChatRoute {
  /** The provider's name, for the request records. */
  label?: string
  /** The provider's base URL (`…/v1`), or its full `…/chat/completions` endpoint. */
  baseUrl: string
  key?: string
  reasoning?: ChatReasoning
  /** Model → the reasoning levels it accepts (for providers that clamp per model). */
  effortLevels?: Record<string, string[]>
}

export interface RouteHandle {
  /** Codex's `base_url` for this route. */
  baseUrl: string
  /** What Codex sends as its key. It opens this route and nothing else, and stops working on `close`. */
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
const keptRecords = 500

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex')

/** `…/v1` → `…/v1/chat/completions`; a base URL that already is the endpoint stays as it is. */
export function chatEndpoint(baseUrl: string) {
  const [path, query] = baseUrl.trim().split(/\?(.*)/s, 2) as [string, string | undefined]
  const base = path.replace(/\/+$/, '')
  return `${/\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`}${query ? `?${query}` : ''}`
}

function sendJson(response: ServerResponse, status: number, body: Json, headers: Record<string, string> = {}) {
  if (response.headersSent)
    return response.end()
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}
const errorBody = (message: string, type: string) => ({ error: { message, type, code: null, param: null } })
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
 * Anna's local routing service: Codex speaks Responses to it, and it speaks Chat Completions to the provider, so a
 * provider without a Responses endpoint can still be Codex's brain. It listens on 127.0.0.1. Each run gets its own
 * route and token; the real key stays here and never reaches the agent's process.
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
      return { baseUrl: `${url}${codexPath}`, token, close: () => routes.delete(hash) }
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

async function handle(routes: Map<string, ChatRoute>, record: (entry: RouteRecord) => void, request: IncomingMessage, response: ServerResponse) {
  // Browsers send Origin; only the agents Anna starts may use a route.
  const bearer = /^Bearer (.+)$/i.exec(request.headers.authorization ?? '')?.[1]?.trim()
  const route = !request.headers.origin && bearer ? routes.get(hashOf(bearer)) : undefined
  if (!route)
    return sendJson(response, 401, errorBody('This route is closed or the token is wrong', 'invalid_api_key'))
  const path = (request.url ?? '').split('?')[0]
  if (request.method !== 'POST' || path !== `${codexPath}/responses`)
    return sendJson(response, 404, errorBody(`Anna's routing does not serve ${request.method} ${path}`, 'not_found'))
  let raw = await readBody(request)
  if (!raw)
    return sendJson(response, 413, errorBody('Request body too large', 'invalid_request_error'))
  const encoding = String(request.headers['content-encoding'] ?? '').trim().toLowerCase()
  if (encoding && encoding !== 'identity') {
    const decode = decoders[encoding]
    if (!decode)
      return sendJson(response, 415, errorBody(`Unsupported content-encoding: ${encoding}`, 'invalid_request_error'))
    try { raw = decode(raw) }
    catch { return sendJson(response, 400, errorBody(`Could not decode the ${encoding} request body`, 'invalid_request_error')) }
  }
  let body: Json
  try { body = JSON.parse(raw.toString('utf8')) }
  catch { return sendJson(response, 400, errorBody('Request body is not JSON', 'invalid_request_error')) }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return sendJson(response, 400, errorBody('Request body must be a JSON object', 'invalid_request_error'))

  const model = typeof body.model === 'string' ? body.model : ''
  const levels = route.effortLevels?.[model]
  const context = toolContextFrom(body)
  const chat = responsesToChat(body, route.reasoning && levels ? { ...route.reasoning, effortLevels: levels } : route.reasoning)
  injectIncludeUsage(chat)
  const stream = chat.stream === true

  // Stop the upstream when Codex goes away (an aborted turn).
  const abort = new AbortController()
  response.on('close', () => abort.abort())
  const started = Date.now()
  const base = { at: new Date(started).toISOString(), ...(route.label ? { provider: route.label } : {}), model }
  let upstream: Response
  try {
    upstream = await fetch(chatEndpoint(route.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': stream ? 'text/event-stream' : 'application/json', ...(route.key ? { authorization: `Bearer ${route.key}` } : {}) },
      body: JSON.stringify(chat),
      signal: abort.signal,
    })
  }
  catch (error) {
    if (abort.signal.aborted)
      return
    record({ ...base, status: 0, latency: Date.now() - started, outcome: 'unreachable' })
    return sendJson(response, 502, errorBody(`Could not reach the provider: ${error instanceof Error ? (error.cause as Error | undefined)?.message ?? error.message : String(error)}`, 'upstream_unreachable'))
  }

  const latency = Date.now() - started
  if (!upstream.ok) {
    record({ ...base, status: upstream.status, latency })
    const text = await upstream.text().catch(() => '')
    let parsed: Json = text || undefined
    try { parsed = JSON.parse(text) }
    catch {}
    const retryAfter = upstream.headers.get('retry-after')
    return sendJson(response, upstream.status, chatErrorToResponseError(parsed), retryAfter ? { 'retry-after': retryAfter } : {})
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
