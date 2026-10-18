import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { RoutingServer } from '../packages/routing/server'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chatEndpoint, claudeModelFor, startRouting } from '../packages/routing/server'

interface Seen { path: string, headers: IncomingMessage['headers'], body: any }
let upstream: Server
let upstreamUrl: string
let seen: Seen[] = []
let reply: (response: ServerResponse, body: any) => void
const closed: string[] = []
let routing: RoutingServer

const sse = (chunks: object[]) => `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`
function textStream(response: ServerResponse) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(sse([{ id: 'chatcmpl_1', model: 'deepseek-v4-flash', choices: [{ delta: { content: 'pong' } }] }, { id: 'chatcmpl_1', model: 'deepseek-v4-flash', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }]))
}

beforeAll(async () => {
  upstream = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk) => { text += chunk })
    request.on('end', () => {
      const body = text ? JSON.parse(text) : undefined
      seen.push({ path: request.url!, headers: request.headers, body })
      reply(response, body)
    })
    response.on('close', () => closed.push(request.url!))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  routing = await startRouting()
})
beforeEach(() => {
  seen = []
  closed.length = 0
  reply = textStream
})
afterAll(async () => {
  await routing.close()
  upstream.closeAllConnections()
  await new Promise(resolve => upstream.close(resolve))
})

const request = { model: 'deepseek-v4-flash', instructions: 'Be brief.', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ping' }] }], stream: true, reasoning: { effort: 'xhigh' } }
function post(route: { baseUrl: string, token: string }, body: unknown = request, headers: Record<string, string> = {}) {
  return fetch(`${route.baseUrl}/responses`, { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${route.token}`, ...headers }, body: typeof body === 'string' || body instanceof Uint8Array ? body as BodyInit : JSON.stringify(body) })
}
const events = (text: string) => text.split('\n\n').flatMap(block => block.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))))

describe('routing a Codex run to a Chat provider', () => {
  it('converts the request, sends the real key upstream and streams Responses events back', async () => {
    const route = routing.open({ baseUrl: `${upstreamUrl}/v1`, key: 'sk-real', reasoning: { supportsThinking: true, supportsEffort: true, thinkingParam: 'thinking', effortParam: 'reasoning_effort', effortValueMode: 'deepseek' } })
    expect(route.token).not.toContain('sk-real')
    const response = await post(route)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const out = events(await response.text())
    expect(out.at(-1)).toMatchObject({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 3, output_tokens: 1 } } })
    expect(out.find(event => event.type === 'response.output_text.done').text).toBe('pong')
    expect(seen).toHaveLength(1)
    expect(seen[0]!.path).toBe('/v1/chat/completions')
    expect(seen[0]!.headers.authorization).toBe('Bearer sk-real')
    expect(seen[0]!.body).toMatchObject({ model: 'deepseek-v4-flash', stream: true, stream_options: { include_usage: true }, thinking: { type: 'enabled' }, reasoning_effort: 'max', messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'ping' }] })
    route.close()
  })

  it('records each request for usage statistics: provider, model, status, latency, tokens; never a key or a body', async () => {
    const route = routing.open({ label: 'DeepSeek Chat', baseUrl: `${upstreamUrl}/v1`, key: 'sk-real' })
    await (await post(route)).text()
    reply = (response) => {
      response.writeHead(429)
      response.end('{}')
    }
    await (await post(route)).text()
    const [ok, limited] = routing.records().slice(-2)
    expect(ok).toEqual({ at: expect.any(String), provider: 'DeepSeek Chat', model: 'deepseek-v4-flash', status: 200, latency: expect.any(Number), usage: { input: 3, output: 1, cached: 0 } })
    expect(limited).toMatchObject({ provider: 'DeepSeek Chat', status: 429 })
    expect(JSON.stringify(routing.records())).not.toMatch(/sk-real|ping|Be brief/)
    route.close()
  })

  it('clamps effort to the model\'s own levels when the provider declares them', async () => {
    const route = routing.open({ baseUrl: `${upstreamUrl}/v1`, key: 'k', reasoning: { supportsEffort: true, effortValueMode: 'zen' }, effortLevels: { 'glm-5.2': ['high', 'max'] } })
    await (await post(route, { ...request, model: 'glm-5.2', reasoning: { effort: 'medium' } })).text()
    expect(seen[0]!.body.reasoning_effort).toBe('high')
    route.close()
  })

  it('answers a non-streaming request with one Responses object', async () => {
    reply = (response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id: 'chatcmpl_9', model: 'm', choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
    }
    const route = routing.open({ baseUrl: `${upstreamUrl}/v1/chat/completions`, key: 'k' })
    const response = await post(route, { ...request, stream: false })
    expect(seen[0]!.path).toBe('/v1/chat/completions')
    expect(seen[0]!.body.stream_options).toBeUndefined()
    expect(await response.json()).toMatchObject({ id: 'resp_chatcmpl_9', object: 'response', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }] })
    route.close()
  })

  it('passes the provider\'s error through as a Responses error, status and retry-after kept', async () => {
    reply = (response) => {
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '7' })
      response.end(JSON.stringify({ error: { message: 'slow down', type: 'rate_limit_error', code: 'rate_limited' } }))
    }
    const route = routing.open({ baseUrl: `${upstreamUrl}/v1`, key: 'k' })
    const response = await post(route)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('7')
    expect(await response.json()).toEqual({ error: { message: 'slow down', type: 'rate_limit_error', code: 'rate_limited', param: null } })
    route.close()
  })

  it('reports an unreachable provider as a 502 Codex can retry', async () => {
    const dead = createServer()
    await new Promise<void>(resolve => dead.listen(0, '127.0.0.1', resolve))
    const port = (dead.address() as { port: number }).port
    await new Promise(resolve => dead.close(resolve))
    const route = routing.open({ baseUrl: `http://127.0.0.1:${port}/v1`, key: 'k' })
    const response = await post(route)
    expect(response.status).toBe(502)
    expect((await response.json()).error.type).toBe('upstream_unreachable')
    expect(routing.records().at(-1)).toMatchObject({ status: 0, outcome: 'unreachable' })
    route.close()
  })

  it('stops the upstream when Codex goes away mid-stream', async () => {
    let finish!: () => void
    const hung = new Promise<void>((resolve) => { finish = resolve })
    reply = (response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ id: 'c', choices: [{ delta: { content: 'thinking…' } }] })}\n\n`)
      response.on('close', finish)
    }
    const route = routing.open({ baseUrl: `${upstreamUrl}/v1`, key: 'k' })
    const abort = new AbortController()
    const response = await fetch(`${route.baseUrl}/responses`, { method: 'POST', headers: { authorization: `Bearer ${route.token}` }, body: JSON.stringify(request), signal: abort.signal })
    const reader = response.body!.getReader()
    await reader.read()
    abort.abort()
    await hung
    expect(closed).toEqual(['/v1/chat/completions'])
    route.close()
  })

  it('reads a compressed request body', async () => {
    const route = routing.open({ baseUrl: `${upstreamUrl}/v1`, key: 'k' })
    const response = await post(route, gzipSync(Buffer.from(JSON.stringify(request))), { 'content-encoding': 'gzip' })
    expect(response.status).toBe(200)
    await response.text()
    expect(seen[0]!.body.messages.at(-1)).toEqual({ role: 'user', content: 'ping' })
    route.close()
  })
})

describe('who may use a route', () => {
  it('only its own token, only while open, never a browser, only the Responses endpoint', async () => {
    const route = routing.open({ baseUrl: `${upstreamUrl}/v1`, key: 'k' })
    expect((await post({ ...route, token: 'anna-route-guess' })).status).toBe(401)
    expect((await post(route, request, { origin: 'https://example.com' })).status).toBe(401)
    expect((await fetch(`${route.baseUrl}/models`, { headers: { authorization: `Bearer ${route.token}` } })).status).toBe(404)
    expect((await post(route, '{not json')).status).toBe(400)
    expect((await post(route, '[1]')).status).toBe(400)
    route.close()
    expect((await post(route)).status).toBe(401)
    expect(seen).toEqual([])
  })

  it('gives every run its own token', () => {
    const one = routing.open({ baseUrl: 'https://a.example/v1' })
    const two = routing.open({ baseUrl: 'https://a.example/v1' })
    expect(one.token).not.toBe(two.token)
    expect(one.baseUrl).toBe(`${routing.url}/codex/v1`)
    one.close()
    two.close()
  })
})

describe('routing a Claude Code run to a Chat provider', () => {
  const messages = { model: 'claude-haiku-4-5', max_tokens: 1024, stream: true, system: [{ type: 'text', text: 'Be brief.' }], messages: [{ role: 'user', content: 'ping' }] }
  const claude = (route: { baseUrl: string, token: string }, body: unknown = messages, headers: Record<string, string> = { 'x-api-key': route.token }) => fetch(`${route.baseUrl}/v1/messages?beta=true`, { method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...headers }, body: JSON.stringify(body) })
  const models = { default: 'deepseek-v4-pro[1M]', haiku: 'deepseek-flash[1M]' }

  it('takes Claude Code\'s key in either header, maps its model, and streams Anthropic events back', async () => {
    const route = routing.open({ client: 'claude', label: 'DS', baseUrl: upstreamUrl, key: 'sk-real', models })
    expect(route.baseUrl).toBe(`${routing.url}/claude`)
    for (const headers of [{ 'x-api-key': route.token }, { authorization: `Bearer ${route.token}` }] as Record<string, string>[]) {
      const response = await claude(route, messages, headers)
      expect(response.status).toBe(200)
      const out = events(await response.text())
      expect(out[0]).toMatchObject({ type: 'message_start' })
      expect(out.find(event => event.type === 'content_block_delta').delta).toEqual({ type: 'text_delta', text: 'pong' })
      expect(out.at(-1)).toEqual({ type: 'message_stop' })
    }
    expect(seen[0]!.path).toBe('/v1/chat/completions')
    expect(seen[0]!.headers.authorization).toBe('Bearer sk-real')
    expect(seen[0]!.body).toMatchObject({ model: 'deepseek-flash', stream: true, stream_options: { include_usage: true }, messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'ping' }] })
    expect(routing.records().at(-1)).toEqual({ at: expect.any(String), provider: 'DS', model: 'deepseek-flash', status: 200, latency: expect.any(Number), usage: { input: 3, output: 1, cached: 0 } })
    route.close()
  })

  it('a DeepSeek tool turn carries its reasoning back', async () => {
    const route = routing.open({ client: 'claude', baseUrl: `${upstreamUrl}/v1`, key: 'k', models })
    const turn = { ...messages, model: 'deepseek-v4-pro[1M]', messages: [{ role: 'user', content: 'date?' }, { role: 'assistant', content: [{ type: 'thinking', thinking: 'Need the date.' }, { type: 'tool_use', id: 'call_date', name: 'get_date', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_date', content: '2026-10-18' }] }] }
    await (await claude(route, turn)).text()
    expect(seen[0]!.path).toBe('/v1/chat/completions')
    expect(seen[0]!.body.model).toBe('deepseek-v4-pro')
    expect(seen[0]!.body.messages[2]).toMatchObject({ role: 'assistant', reasoning_content: 'Need the date.' })
    route.close()
  })

  it('a non-streaming request gets one Anthropic message; errors come in Anthropic\'s format with the status', async () => {
    reply = (response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id: 'chatcmpl_9', model: 'm', choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
    }
    const route = routing.open({ client: 'claude', baseUrl: upstreamUrl, key: 'k', models })
    expect(await (await claude(route, { ...messages, stream: false })).json()).toMatchObject({ id: 'chatcmpl_9', type: 'message', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' })
    reply = (response) => {
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '3' })
      response.end(JSON.stringify({ error: { message: 'slow down' } }))
    }
    const limited = await claude(route)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('3')
    expect(await limited.json()).toEqual({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } })
    route.close()
  })

  it('a route serves only its own agent\'s endpoint', async () => {
    const claudeRoute = routing.open({ client: 'claude', baseUrl: upstreamUrl, key: 'k' })
    const codexRoute = routing.open({ baseUrl: `${upstreamUrl}/v1`, key: 'k' })
    expect((await fetch(`${routing.url}/codex/v1/responses`, { method: 'POST', headers: { authorization: `Bearer ${claudeRoute.token}` }, body: JSON.stringify(request) })).status).toBe(404)
    expect((await fetch(`${routing.url}/claude/v1/messages`, { method: 'POST', headers: { 'x-api-key': codexRoute.token }, body: JSON.stringify(messages) })).status).toBe(404)
    const countTokens = await fetch(`${claudeRoute.baseUrl}/v1/messages/count_tokens`, { method: 'POST', headers: { 'x-api-key': claudeRoute.token }, body: '{}' })
    expect(countTokens.status).toBe(404)
    expect((await countTokens.json()).type).toBe('error')
    expect(seen).toEqual([])
    claudeRoute.close()
    codexRoute.close()
  })

  it('claude Code\'s model names: the route\'s own as they are, Claude tiers by tier, the rest to the default; [1m] dropped', () => {
    const tiers = { default: 'glm-5.3[1M]', haiku: 'glm-5.3-flash', opus: 'glm-5.3-pro' }
    expect(claudeModelFor('glm-5.3-flash', tiers)).toBe('glm-5.3-flash')
    expect(claudeModelFor('glm-5.3[1m]', tiers)).toBe('glm-5.3')
    expect(claudeModelFor('claude-haiku-4-5-20251001', tiers)).toBe('glm-5.3-flash')
    expect(claudeModelFor('claude-opus-5-5', tiers)).toBe('glm-5.3-pro')
    expect(claudeModelFor('claude-fable-5-1', tiers)).toBe('glm-5.3-pro')
    expect(claudeModelFor('claude-sonnet-5-5', tiers)).toBe('glm-5.3')
    expect(claudeModelFor('anything-else', tiers)).toBe('glm-5.3')
    expect(claudeModelFor('my-model[1M]')).toBe('my-model')
  })
})

describe('the provider endpoint', () => {
  it('appends /chat/completions unless the base URL already is the endpoint', () => {
    expect(chatEndpoint('https://api.example.com/v1')).toBe('https://api.example.com/v1/chat/completions')
    expect(chatEndpoint('https://api.example.com/v1/')).toBe('https://api.example.com/v1/chat/completions')
    expect(chatEndpoint(' https://api.example.com/v4/chat/completions/ ')).toBe('https://api.example.com/v4/chat/completions')
    expect(chatEndpoint('https://api.example.com/openai?api-version=1')).toBe('https://api.example.com/openai/chat/completions?api-version=1')
    // Claude Code's base URLs leave the version out.
    expect(chatEndpoint('https://integrate.api.nvidia.com', 'claude')).toBe('https://integrate.api.nvidia.com/v1/chat/completions')
    expect(chatEndpoint('https://api.groq.com/openai/v1', 'claude')).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(chatEndpoint('https://open.bigmodel.cn/api/paas/v4/chat/completions', 'claude')).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions')
  })
})
