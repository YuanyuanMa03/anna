import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { FailoverEvent, RoutingServer, Upstream } from '../packages/routing/server'
import { createServer } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CircuitBreaker, failoverDefaults, retryableStatus } from '../packages/routing/breaker'
import { startRouting } from '../packages/routing/server'

describe('circuit breaker (cc-switch\'s state machine and defaults)', () => {
  const policy = { ...failoverDefaults.codex, failureThreshold: 3, successThreshold: 2, openSeconds: 60, errorRate: 0.5, minRequests: 6 }
  let now = 0
  const breaker = () => new CircuitBreaker(() => policy, () => now)
  beforeEach(() => { now = 0 })

  it('opens after consecutive failures, lets one probe through after the wait, closes after enough successes', () => {
    const b = breaker()
    for (let i = 0; i < 3; i++) b.failure(b.allow().probe)
    expect(b.stats().state).toBe('open')
    expect(b.available()).toBe(false)
    expect(b.allow().allowed).toBe(false)
    now = 60_000
    expect(b.available()).toBe(true)
    const probe = b.allow()
    expect(probe).toEqual({ allowed: true, probe: true })
    expect(b.allow().allowed).toBe(false)
    b.success(probe.probe)
    expect(b.stats().state).toBe('half_open')
    b.success(b.allow().probe)
    expect(b.stats()).toMatchObject({ state: 'closed', total: 0, failed: 0 })
  })

  it('a failed probe opens it again; a neutral result only frees the probe', () => {
    const b = breaker()
    for (let i = 0; i < 3; i++) b.failure(false)
    now = 60_000
    const probe = b.allow()
    b.neutral(probe.probe)
    expect(b.allow().allowed).toBe(true)
    b.failure(true)
    expect(b.stats().state).toBe('open')
    expect(b.stats().openedAt).toBe(60_000)
  })

  it('opens on the error rate too, once enough requests were seen; a success resets the streak', () => {
    const b = breaker()
    for (const ok of [true, false, true, false, false, true]) ok ? b.success(false) : b.failure(false)
    expect(b.stats().state).toBe('closed')
    b.failure(false)
    expect(b.stats().state).toBe('open')
  })

  it('claude Code\'s defaults are more patient than Codex\'s; malformed requests never move on', () => {
    expect(failoverDefaults.claude).toMatchObject({ maxRetries: 6, firstByteTimeout: 90, failureThreshold: 8, openSeconds: 90 })
    expect(failoverDefaults.codex).toMatchObject({ maxRetries: 3, firstByteTimeout: 60, failureThreshold: 4, openSeconds: 60 })
    for (const status of [400, 405, 406, 413, 414, 415, 422, 501]) expect(retryableStatus(status)).toBe(false)
    for (const status of [401, 403, 404, 408, 409, 429, 500, 502, 503, 529]) expect(retryableStatus(status)).toBe(true)
  })
})

type Behavior = (request: IncomingMessage, response: ServerResponse, body: any) => void
let upstream: Server
let base: string
const behaviors: Record<string, Behavior> = {}
const seen: { name: string, path: string, headers: IncomingMessage['headers'], body: any }[] = []
let routing: RoutingServer

const sse = (chunks: object[]) => `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`
function chatText(text: string): Behavior {
  return (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(sse([{ id: 'c', choices: [{ delta: { content: text } }] }, { id: 'c', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }]))
  }
}
function status(code: number, message = `status ${code}`): Behavior {
  return (_request, response) => {
    response.writeHead(code, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message } }))
  }
}

beforeAll(async () => {
  upstream = createServer((request, response) => {
    const name = request.url!.split('/')[1]!
    let text = ''
    request.on('data', (chunk) => { text += chunk })
    request.on('end', () => {
      const body = text ? JSON.parse(text) : undefined
      seen.push({ name, path: request.url!, headers: request.headers, body })
      behaviors[name]?.(request, response, body)
    })
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  routing = await startRouting()
})
beforeEach(() => {
  seen.length = 0
  for (const key of Object.keys(behaviors)) delete behaviors[key]
})
afterAll(async () => {
  await routing.close()
  upstream.closeAllConnections()
  await new Promise(resolve => upstream.close(resolve))
})

const provider = (name: string, extra: Partial<Upstream> = {}): Upstream => ({ id: `${name}-${Math.random()}`, label: name, baseUrl: `${base}/${name}/v1`, key: `sk-${name}`, ...extra })
const responsesRequest = { model: 'first-model', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ping' }] }], stream: true }
async function codex(route: Parameters<RoutingServer['open']>[0], body: object = responsesRequest) {
  const handle = routing.open(route)
  const response = await fetch(`${handle.baseUrl}/responses`, { method: 'POST', headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify(body) })
  const text = await response.text()
  handle.close()
  return { status: response.status, text, response }
}
const fast = { firstByteTimeout: 0.3, idleTimeout: 0.3, requestTimeout: 1 }

describe('failover between providers', () => {
  it('a failing provider hands the request to the next; the agent only sees the answer', async () => {
    behaviors.a = status(503)
    behaviors.b = chatText('from b')
    const events: FailoverEvent[] = []
    const { status: code, text } = await codex({ ...provider('a', { model: 'a-model' }), backups: [provider('b', { model: 'b-model' })], failover: fast, onFailover: event => events.push(event) })
    expect(code).toBe(200)
    expect(text).toContain('from b')
    expect(seen.map(item => [item.name, item.body.model, item.headers.authorization])).toEqual([['a', 'a-model', 'Bearer sk-a'], ['b', 'b-model', 'Bearer sk-b']])
    expect(events).toEqual([{ from: 'a', to: 'b', kind: 'status', status: 503, reason: 'HTTP 503' }])
    expect(routing.records().slice(-2).map(item => [item.provider, item.status])).toEqual([['a', 503], ['b', 200]])
  })

  it('unreachable, no first byte in time, an empty stream: all move on', async () => {
    const dead = createServer()
    await new Promise<void>(resolve => dead.listen(0, '127.0.0.1', resolve))
    const deadUrl = `http://127.0.0.1:${(dead.address() as { port: number }).port}`
    await new Promise(resolve => dead.close(resolve))
    behaviors.slow = (_request, response) => response.writeHead(200, { 'content-type': 'text/event-stream' })
    behaviors.empty = (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end()
    }
    behaviors.good = chatText('finally')
    const events: FailoverEvent[] = []
    const { text } = await codex({ ...provider('gone', { baseUrl: `${deadUrl}/v1` }), backups: [provider('slow'), provider('empty'), provider('good')], failover: fast, onFailover: event => events.push(event) })
    expect(text).toContain('finally')
    expect(events.map(event => [event.from, event.to, event.kind])).toEqual([['gone', 'slow', 'unreachable'], ['slow', 'empty', 'timeout'], ['empty', 'good', 'empty']])
    expect(events[0]!.reason).toMatch(/could not reach/)
    expect(events[1]!.reason).toBe('no first byte within 0.3 s')
    expect(events[2]!.reason).toBe('the provider sent an empty stream')
    upstream.closeAllConnections()
  })

  it('a malformed request is not retried elsewhere: the first provider\'s error goes to the agent', async () => {
    behaviors.a = status(400, 'bad request')
    behaviors.b = chatText('never')
    const { status: code, text } = await codex({ ...provider('a'), backups: [provider('b')], failover: fast })
    expect(code).toBe(400)
    expect(JSON.parse(text).error.message).toBe('bad request')
    expect(seen.map(item => item.name)).toEqual(['a'])
  })

  it('when every provider fails, the last one\'s error goes to the agent, and the note says nothing is left', async () => {
    behaviors.a = status(503)
    behaviors.b = status(429, 'slow down')
    const events: FailoverEvent[] = []
    const { status: code, text } = await codex({ ...provider('a'), backups: [provider('b')], failover: fast, onFailover: event => events.push(event) })
    expect(code).toBe(429)
    expect(JSON.parse(text).error.message).toBe('slow down')
    expect(events.at(-1)).toEqual({ from: 'b', kind: 'status', status: 429, reason: 'HTTP 429' })
  })

  it('at most maxRetries + 1 providers are tried', async () => {
    for (const name of ['a', 'b', 'c']) behaviors[name] = status(500)
    await codex({ ...provider('a'), backups: [provider('b'), provider('c')], failover: { ...fast, maxRetries: 1 } })
    expect(seen.map(item => item.name)).toEqual(['a', 'b'])
  })

  it('once the agent has bytes, an error is the agent\'s: no second provider, nothing spliced', async () => {
    behaviors.a = (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ id: 'c', choices: [{ delta: { content: 'half' } }] })}\n\n`)
      setTimeout(() => response.destroy(), 20)
    }
    behaviors.b = chatText('never')
    const { text } = await codex({ ...provider('a'), backups: [provider('b')], failover: fast })
    expect(text).toContain('half')
    expect(text).toContain('event: response.failed')
    expect(seen.map(item => item.name)).toEqual(['a'])
  })

  it('a stream that goes silent too long is ended as failed, and the provider\'s request stops', async () => {
    let closed = false
    behaviors.a = (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ id: 'c', choices: [{ delta: { content: 'thinking' } }] })}\n\n`)
      response.on('close', () => { closed = true })
    }
    const { text } = await codex({ ...provider('a'), backups: [provider('b')], failover: fast })
    expect(text).toContain('event: response.failed')
    expect(text).toContain('no data for 0.3 s')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(closed).toBe(true)
  })

  it('a provider that keeps failing is skipped (its breaker opens), and shows up in the health report', async () => {
    const a = provider('a')
    const b = provider('b')
    behaviors.a = status(502)
    behaviors.b = chatText('ok')
    for (let i = 0; i < failoverDefaults.codex.failureThreshold; i++) await codex({ ...a, backups: [b], failover: fast })
    seen.length = 0
    await codex({ ...a, backups: [b], failover: fast })
    expect(seen.map(item => item.name)).toEqual(['b'])
    expect(routing.health()[`codex:${a.id}`]).toMatchObject({ state: 'open' })
    expect(routing.health()[`codex:${b.id}`]).toMatchObject({ state: 'closed' })
    routing.resetHealth(`codex:${a.id}`)
    expect(routing.health()[`codex:${a.id}`]!.state).toBe('closed')
  })

  it('without backups: one try, no timeouts, no breaker, exactly as before', async () => {
    const only = provider('a')
    behaviors.a = status(503)
    for (let i = 0; i < 6; i++) await codex(only)
    expect(seen).toHaveLength(6)
    expect(routing.health()).not.toHaveProperty(`codex:${only.id}`)
  })
})

describe('providers in the agent\'s own format, passed through', () => {
  it('codex: Responses go to …/responses as they are, with this provider\'s model and key; web_search dropped where rejected', async () => {
    behaviors.n = (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 9, output_tokens: 2, input_tokens_details: { cached_tokens: 4 } } } })}\n\n`)
    }
    behaviors.a = status(503)
    const native = provider('n', { format: 'native', model: 'native-model', dropWebSearch: true })
    const { text } = await codex({ ...provider('a'), backups: [native], failover: fast }, { ...responsesRequest, tools: [{ type: 'web_search' }, { type: 'function', name: 'shell', parameters: {} }] })
    expect(text).toBe(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 9, output_tokens: 2, input_tokens_details: { cached_tokens: 4 } } } })}\n\n`)
    const sent = seen.find(item => item.name === 'n')!
    expect(sent.path).toBe('/n/v1/responses')
    expect(sent.headers.authorization).toBe('Bearer sk-n')
    expect(sent.body).toMatchObject({ model: 'native-model', input: responsesRequest.input, tools: [{ type: 'function', name: 'shell' }] })
    expect(routing.records().at(-1)).toMatchObject({ provider: 'n', usage: { input: 9, output: 2, cached: 4 } })
  })

  it('claude Code: Messages go to …/v1/messages with its headers and query, the key in its own header, the model by tier', async () => {
    const anthropicStream = 'event: message_start\ndata: {"type":"message_start","message":{"id":"m","content":[]}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":5,"output_tokens":3}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'
    behaviors.c = status(529)
    behaviors.m = (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(anthropicStream)
    }
    const handle = routing.open({ client: 'claude', ...provider('c', { models: { default: 'chat-pro', haiku: 'chat-flash' } }), backups: [provider('m', { format: 'native', baseUrl: `${base}/m/anthropic`, keyHeader: 'x-api-key', models: { default: 'native-pro', haiku: 'native-flash' } })], failover: fast })
    const response = await fetch(`${handle.baseUrl}/v1/messages?beta=true`, { method: 'POST', headers: { 'x-api-key': handle.token, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'interleaved-thinking-2025-05-14' }, body: JSON.stringify({ model: 'chat-flash', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hi' }] }) })
    expect(await response.text()).toBe(anthropicStream)
    handle.close()
    const sent = seen.find(item => item.name === 'm')!
    expect(sent.path).toBe('/m/anthropic/v1/messages?beta=true')
    expect(sent.headers).toMatchObject({ 'x-api-key': 'sk-m', 'anthropic-version': '2023-06-01', 'anthropic-beta': 'interleaved-thinking-2025-05-14' })
    expect(sent.headers.authorization).toBeUndefined()
    expect(sent.body.model).toBe('native-flash')
    expect(seen.find(item => item.name === 'c')!.body.model).toBe('chat-flash')
    expect(routing.records().at(-1)).toMatchObject({ provider: 'm', usage: { input: 5, output: 3, cached: 0 } })
  })

  it('a native provider\'s error goes to the agent as the provider sent it', async () => {
    behaviors.n = (_request, response) => {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens too large' } }))
    }
    const handle = routing.open({ client: 'claude', ...provider('n', { format: 'native', baseUrl: `${base}/n` }) })
    const response = await fetch(`${handle.baseUrl}/v1/messages`, { method: 'POST', headers: { 'x-api-key': handle.token }, body: JSON.stringify({ model: 'm', max_tokens: 10, messages: [] }) })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens too large' } })
    handle.close()
  })
})
