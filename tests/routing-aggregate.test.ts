import type { Server } from 'node:http'
import type { Preset } from '../packages/agents/providers'
import type { RoutingServer } from '../packages/routing/server'
import { createServer } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { claudePickerRows, codexAggregateCatalog, modelKeyFor } from '../packages/agents/aggregate'
import { codexCatalog } from '../packages/agents/codex-catalog'
import { chatRouteOf, upstreamOf } from '../packages/agents/providers'
import { aggregateId, parseAggregateId, startRouting } from '../packages/routing/server'

/** Aggregation: listed providers' models under prefixed ids, each request going to that provider alone. */

let upstream: Server
let base: string
let routing: RoutingServer
let hits: { name: string, path: string, model?: string, authorization?: string }[] = []
beforeAll(async () => {
  upstream = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk) => { text += chunk })
    request.on('end', () => {
      const name = request.url!.split('/')[1]!
      hits.push({ name, path: request.url!, model: text ? JSON.parse(text).model : undefined, authorization: request.headers.authorization })
      if (name === 'down') {
        response.writeHead(503, { 'content-type': 'application/json' })
        return response.end('{"error":{"message":"down"}}')
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ id: 'c', choices: [{ delta: { content: `from ${name}` }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
    })
  })
  await new Promise<void>(done => upstream.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  routing = await startRouting()
})
beforeEach(() => { hits = [] })
afterAll(async () => {
  await routing.close()
  upstream.closeAllConnections()
  upstream.close()
})

const codex = (name: string, extra: Partial<Preset> = {}): Preset => ({ name, official: false, category: 'custom', baseUrl: `${base}/${name}/v1`, model: `${name}-model`, apiFormat: 'openai_chat', ...extra })
const claude = (name: string, env: Record<string, string> = {}): Preset => ({ name, official: false, category: 'custom', apiFormat: 'openai_chat', env: { ANTHROPIC_BASE_URL: `${base}/${name}`, ANTHROPIC_MODEL: `${name}-model`, ...env } })

describe('keys and ids', () => {
  it('a key from the name: lowercase, single dashes, a hash for names without letters, a number when taken', () => {
    expect(modelKeyFor('Kimi For Coding', [])).toBe('kimi-for-coding')
    expect(modelKeyFor('  DeepSeek / 官方 ', [])).toBe('deepseek')
    expect(modelKeyFor('月之暗面', [])).toMatch(/^p[0-9a-f]{6}$/)
    expect(modelKeyFor('Kimi', ['kimi', 'kimi-2'])).toBe('kimi-3')
    const long = modelKeyFor('a very long provider name -- with dashes', [])
    expect(long.length).toBeLessThanOrEqual(24)
    expect(long).not.toMatch(/--|-$/)
  })

  it('ids are taken apart at the first separator; plain names stay plain; a broken prefixed id is refused', () => {
    expect(aggregateId('codex', 'kimi', 'kimi-k3')).toBe('anna-kimi/kimi-k3')
    expect(parseAggregateId('codex', 'anna-or/openai/gpt-6')).toEqual({ key: 'or', model: 'openai/gpt-6' })
    expect(parseAggregateId('codex', 'anna-model')).toBeUndefined()
    expect(parseAggregateId('codex', 'gpt-6')).toBeUndefined()
    expect(parseAggregateId('codex', 'anna-/x')).toBeNull()
    expect(aggregateId('claude', 'glm', 'glm-5')).toBe('anna-claude-glm--glm-5')
    expect(parseAggregateId('claude', 'anna-claude-glm--glm--5[1M]')).toEqual({ key: 'glm', model: 'glm--5[1M]' })
    expect(parseAggregateId('claude', 'claude-sonnet-5')).toBeUndefined()
    expect(parseAggregateId('claude', 'anna-claude-glm')).toBeNull()
  })
})

describe('what the agents list', () => {
  it('claude Code: one picker row per model, deduplicated, [1M] kept, with a known model\'s handling', () => {
    const rows = claudePickerRows([{ key: 'glm', choice: { preset: claude('GLM', { ANTHROPIC_MODEL: 'glm-5[1M]', ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-air' }) } }])
    expect(rows).toEqual([
      { model: 'anna-claude-glm--glm-5[1M]', label: 'glm-5（GLM）', description: '经 Anna 的路由发给 GLM', behavesAs: 'claude-sonnet-5' },
      { model: 'anna-claude-glm--glm-air', label: 'glm-air（GLM）', description: '经 Anna 的路由发给 GLM', behavesAs: 'claude-sonnet-5' },
    ])
  })

  it('codex: the provider in use\'s rows as they are, then the listed ones\' under prefixed slugs', () => {
    const inUse = codexCatalog(codex('a'))
    const catalog = codexAggregateCatalog(inUse, [{ key: 'b', choice: { preset: codex('B', { model: 'b-model', models: [{ model: 'b-model' }, { model: 'b-mini', displayName: 'B Mini' }] }) } }])!
    expect(catalog.models[0]).toEqual(inUse!.models[0])
    expect(catalog.models.slice(1).map(entry => [entry.slug, entry.display_name, entry.priority])).toEqual([['anna-b/b-model', 'b-model（B）', 1001], ['anna-b/b-mini', 'B Mini（B）', 1002]])
    expect(codexAggregateCatalog(inUse, [])).toEqual(inUse)
  })
})

describe('the route', () => {
  const ask = (url: string, token: string, model: string) => fetch(`${url}/responses`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ model, input: 'hi', stream: true }) })

  it('codex: a prefixed id goes to that provider with its model; a plain one to the provider in use', async () => {
    const route = routing.open({ ...chatRouteOf('codex', { preset: codex('a'), key: 'sk-a' }), aggregate: { b: upstreamOf('codex', { preset: codex('b'), key: 'sk-b' }) } })
    expect(await (await ask(route.baseUrl, route.token, 'anna-b/b-large')).text()).toContain('from b')
    expect(await (await ask(route.baseUrl, route.token, 'a-model')).text()).toContain('from a')
    expect(hits.map(hit => [hit.path, hit.model, hit.authorization])).toEqual([['/b/v1/chat/completions', 'b-large', 'Bearer sk-b'], ['/a/v1/chat/completions', 'a-model', 'Bearer sk-a']])
    route.close()
  })

  it('an id that no longer resolves is refused, never answered by the provider in use', async () => {
    const route = routing.open({ ...chatRouteOf('codex', { preset: codex('a'), key: 'sk-a' }), aggregate: {} })
    const response = await ask(route.baseUrl, route.token, 'anna-gone/m')
    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('pick another model')
    expect(hits).toEqual([])
    route.close()
  })

  it('a listed provider that fails is not replaced by the backups', async () => {
    const route = routing.open({ ...chatRouteOf('codex', { preset: codex('a'), key: 'sk-a' }), backups: [upstreamOf('codex', { preset: codex('c'), key: 'sk-c' })], aggregate: { down: upstreamOf('codex', { preset: codex('down'), key: 'k' }) } })
    expect((await ask(route.baseUrl, route.token, 'anna-down/x')).status).toBe(503)
    expect(hits.map(hit => hit.name)).toEqual(['down'])
    route.close()
  })

  it('claude Code: the model part goes as it is, [1M] dropped; an unknown key gets an Anthropic error', async () => {
    const route = routing.open({ ...chatRouteOf('claude', { preset: claude('a'), key: 'sk-a' }), aggregate: { glm: upstreamOf('claude', { preset: claude('glm'), key: 'sk-glm' }) } })
    const send = (model: string) => fetch(`${route.baseUrl}/v1/messages`, { method: 'POST', headers: { 'x-api-key': route.token }, body: JSON.stringify({ model, max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hi' }] }) })
    expect(await (await send('anna-claude-glm--glm-5[1M]')).text()).toContain('from glm')
    expect(hits.at(-1)).toMatchObject({ path: '/glm/v1/chat/completions', model: 'glm-5', authorization: 'Bearer sk-glm' })
    const refused = await send('anna-claude-nope--x')
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ type: 'error', error: { type: 'invalid_request_error' } })
    route.close()
  })
})
