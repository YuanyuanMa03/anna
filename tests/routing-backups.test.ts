import type { Server } from 'node:http'
import type { Preset } from '../packages/agents/providers'
import type { FailoverEvent } from '../packages/routing/server'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findPreset, providerLaunch, upstreamOf } from '../packages/agents/providers'
import { failoverLine, openRoute } from '../packages/agents/route'

/** Backups for Anna's own runs: when a route opens, what the agent is given, and what the stage says. */

let server: Server
let base: string
const hits: { name: string, path: string, model: string, authorization?: string }[] = []
beforeAll(async () => {
  server = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk) => { text += chunk })
    request.on('end', () => {
      const name = request.url!.split('/')[1]!
      hits.push({ name, path: request.url!, model: JSON.parse(text).model, authorization: request.headers.authorization })
      if (name === 'down') {
        response.writeHead(503, { 'content-type': 'application/json' })
        return response.end('{"error":{"message":"down"}}')
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ id: 'c', choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})

const codex = (name: string, extra: Partial<Preset> = {}): Preset => ({ name, official: false, category: 'custom', baseUrl: `${base}/${name}/v1`, model: `${name}-model`, ...extra })

describe('when a run goes through Anna\'s routing', () => {
  it('a provider the agent speaks natively, without backups: directly, as before', async () => {
    expect(await openRoute('codex', { preset: findPreset('codex', 'DeepSeek')!, key: 'k' })).toBeUndefined()
    expect(await openRoute('claude', { preset: findPreset('claude', 'DeepSeek')!, key: 'k' }, { backups: [] })).toBeUndefined()
  })

  it('its own login can\'t be routed, and can\'t be a backup', async () => {
    expect(await openRoute('codex', { preset: findPreset('codex', 'OpenAI Official')! }, { backups: [{ preset: codex('b', { apiFormat: 'openai_chat' }), key: 'k' }] })).toBeUndefined()
    expect(await openRoute('codex', { preset: findPreset('codex', 'DeepSeek')!, key: 'k' }, { backups: [{ preset: findPreset('codex', 'OpenAI Official')! }] })).toBeUndefined()
    expect(await openRoute('gemini', { preset: findPreset('gemini', 'OpenRouter')!, key: 'k' }, { backups: [{ preset: findPreset('gemini', 'OpenRouter')!, key: 'k' }] })).toBeUndefined()
  })

  it('with a backup, a native provider goes through the route too, and a failure moves to the backup with a line for the stage', async () => {
    const events: FailoverEvent[] = []
    const route = (await openRoute('codex', { preset: codex('down'), key: 'sk-down' }, { backups: [{ preset: codex('down'), key: 'same' }, { preset: codex('chat', { apiFormat: 'openai_chat' }), key: 'sk-chat' }], onFailover: event => events.push(event) }))!
    expect(route).toBeDefined()
    const response = await fetch(`${route.baseUrl}/responses`, { method: 'POST', headers: { authorization: `Bearer ${route.token}` }, body: JSON.stringify({ model: 'down-model', input: 'hi', stream: true }) })
    expect(await response.text()).toContain('event: response.completed')
    route.close()
    // The duplicate of the run's own provider was left out of the backups.
    expect(hits.map(hit => [hit.path, hit.model, hit.authorization])).toEqual([['/down/v1/responses', 'down-model', 'Bearer sk-down'], ['/chat/v1/chat/completions', 'chat-model', 'Bearer sk-chat']])
    expect(events.map(failoverLine)).toEqual(['down 返回了 503，换成 chat'])
  })
})

describe('what the agent is given', () => {
  const route = { baseUrl: 'http://127.0.0.1:4567/codex/v1', token: 'anna-route-abc' }

  it('codex on a native provider with a route: the route and its token; web_search still off where the provider rejects it', () => {
    const minimax = findPreset('codex', 'MiniMax')!
    const launch = providerLaunch('codex', { preset: minimax, key: 'sk-real' }, route)
    expect(launch.args).toContain(`model_providers.anna.base_url="${route.baseUrl}"`)
    expect(launch.env).toEqual({ ANNA_PROVIDER_KEY: route.token })
    expect(launch.args).toContain('web_search="disabled"')
    expect(JSON.stringify(launch)).not.toContain('sk-real')
  })

  it('claude Code on a native provider with a route: its base URL and token, the key in Anna; the routing knows its key header', () => {
    const deepseek = findPreset('claude', 'DeepSeek')!
    const { env } = providerLaunch('claude', { preset: deepseek, key: 'sk-real' }, { baseUrl: 'http://127.0.0.1:4567/claude', token: 'anna-route-abc' })
    expect(env).toMatchObject({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:4567/claude', ANTHROPIC_AUTH_TOKEN: 'anna-route-abc' })
    expect(JSON.stringify(env)).not.toContain('sk-real')
    expect(upstreamOf('claude', { preset: deepseek, key: 'sk-real' })).toMatchObject({ format: 'native', baseUrl: deepseek.env!.ANTHROPIC_BASE_URL, key: 'sk-real', keyHeader: deepseek.keyField === 'ANTHROPIC_API_KEY' ? 'x-api-key' : 'authorization' })
    expect(upstreamOf('codex', { preset: findPreset('codex', 'MiniMax')!, key: 'k' })).toMatchObject({ format: 'native', dropWebSearch: true })
  })

  it('the stage line, in every case', () => {
    expect(failoverLine({ from: 'A', to: 'B', kind: 'status', status: 429, reason: 'HTTP 429' })).toBe('A 返回了 429，换成 B')
    expect(failoverLine({ from: 'A', to: 'B', kind: 'timeout', reason: '' })).toBe('A 迟迟没有回应，换成 B')
    expect(failoverLine({ from: 'A', to: 'B', kind: 'unreachable', reason: '' })).toBe('A 连不上，换成 B')
    expect(failoverLine({ from: 'A', to: 'B', kind: 'empty', reason: '' })).toBe('A 返回了空内容，换成 B')
    expect(failoverLine({ from: 'B', kind: 'status', status: 500, reason: '' })).toBe('B 返回了 500，备用服务商也都不行')
  })
})

describe('on stage', () => {
  it('a failover during the brain\'s turn shows as a retry with the line', async () => {
    const { Presence } = await import('../packages/anna-host/presence')
    const presence = new Presence(() => {})
    presence.handle({ type: 'failover', line: 'DeepSeek 返回了 503，换成 Kimi' })
    expect(presence.state).toMatchObject({ phase: 'retrying', line: 'DeepSeek 返回了 503，换成 Kimi' })
  })
})

describe('kept across restarts', () => {
  it('the settings file keeps the backup queue', async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { SettingsStore } = await import('../packages/anna-host/settings')
    const directory = await mkdtemp(join(tmpdir(), 'anna-settings-'))
    const store = new SettingsStore(directory)
    await store.load()
    store.value.agents = { codex: { provider: 'DeepSeek', backups: ['Kimi', 'PPIO'] } }
    await store.save()
    const again = new SettingsStore(directory)
    await again.load()
    expect(again.value.agents).toEqual({ codex: { provider: 'DeepSeek', backups: ['Kimi', 'PPIO'] } })
  })
})
