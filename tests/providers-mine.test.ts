import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { expect, it, vi } from 'vitest'
import { providerEndpoint } from '../packages/anna-host/agents-hub'
import { Host } from '../packages/anna-host/host'
import { scriptedBackend } from '../packages/kernels/pi/backend'
import { createPiKernel } from '../packages/kernels/pi/kernel'

const fake = resolve('tests/fixtures/fake-agent.mjs')

async function setup(options: { fetch?: typeof fetch, script?: import('../packages/kernels/pi/backend').ScriptStep[], characterId?: string } = {}) {
  const data = await mkdtemp(join(tmpdir(), 'anna-providers-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  process.env.ANNA_FAKE_LOG = join(data, 'fake.log')
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: options.characterId ?? 'hiyori', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'auto', rules: { allow: [], ask: [], deny: [] } } } }))
  const secrets: Record<string, string> = {}
  const backend = await scriptedBackend(options.script ?? [], data)
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, () => {}, {
    sandbox: { available: false, reason: 'test' },
    kernel: context => createPiKernel(context, backend),
    secrets: { read: async () => secrets.providers ?? '', write: async (value) => { secrets.providers = value } },
    agents: { locate: agent => ({ command: process.execPath, prefix: [fake, agent] }), detect: async () => [], fetch: options.fetch },
  })
  await host.initialize()
  const keys = () => JSON.parse(secrets.providers ?? '{}') as Record<string, string>
  return { host, data, keys }
}

it('my providers: add from a preset with a different model, use it, rename it (key and choice follow), delete it', async () => {
  const { host, data, keys } = await setup()
  await host.execute({ type: 'provider-save', app: 'codex', name: 'DeepSeek', from: 'DeepSeek', model: 'deepseek-v4-pro', key: 'sk-1' })
  expect(host.snapshot().agents.mine.codex).toEqual([expect.objectContaining({ name: 'DeepSeek', source: 'preset', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', hasKey: true })])
  expect(JSON.stringify(host.snapshot())).not.toContain('sk-1')
  await host.execute({ type: 'agent-provider', agent: 'codex', provider: 'DeepSeek' })
  // The edited model is what Codex runs with; the preset's model rows still feed its catalog.
  const sent = host.execute({ type: 'send', text: '@codex 你好' })
  await vi.waitUntil(() => host.snapshot().approvals.length > 0, { timeout: 8000 })
  await host.execute({ type: 'approval', id: host.snapshot().approvals[0]!.id, allow: true })
  await sent
  const run = (await readFile(join(data, 'fake.log'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).at(-1)
  expect(run.args).toEqual(expect.arrayContaining(['model="deepseek-v4-pro"', 'model_providers.anna.base_url="https://api.deepseek.com"']))

  await host.execute({ type: 'provider-save', app: 'codex', name: 'DS 工作', previous: 'DeepSeek' })
  expect(host.snapshot().agents.mine.codex.map(item => [item.name, item.model, item.hasKey])).toEqual([['DS 工作', 'deepseek-v4-pro', true]])
  expect(host.snapshot().agents.providers.codex?.provider).toBe('DS 工作')
  expect(keys()).toEqual({ 'codex:DS 工作': 'sk-1' })

  await host.execute({ type: 'provider-delete', app: 'codex', name: 'DS 工作' })
  expect(host.snapshot().agents.mine.codex).toEqual([])
  expect(host.snapshot().agents.providers.codex?.provider).toBeUndefined()
  expect(keys()).toEqual({})
  await host.close()
})

it('custom providers by hand for each app: endpoint and model land where that app reads them', async () => {
  const { host } = await setup()
  await host.execute({ type: 'provider-save', app: 'claude', name: 'My relay', baseUrl: 'https://relay.example.com/anthropic/', model: 'claude-x' })
  await host.execute({ type: 'provider-save', app: 'gemini', name: 'Local', baseUrl: 'http://127.0.0.1:8080', model: 'gemma' })
  await host.execute({ type: 'provider-save', app: 'codex', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen3' })
  const mine = host.snapshot().agents.mine
  expect(mine.claude).toEqual([expect.objectContaining({ name: 'My relay', source: 'custom', baseUrl: 'https://relay.example.com/anthropic', model: 'claude-x', hasKey: false })])
  expect(mine.gemini).toEqual([expect.objectContaining({ baseUrl: 'http://127.0.0.1:8080', model: 'gemma' })])
  expect(mine.codex).toEqual([expect.objectContaining({ baseUrl: 'http://localhost:11434/v1', model: 'qwen3' })])
  // Mistakes are refused with the reason, and nothing is saved.
  await expect(host.execute({ type: 'provider-save', app: 'codex', name: 'No model', baseUrl: 'https://x.example.com' })).rejects.toThrow('模型')
  await expect(host.execute({ type: 'provider-save', app: 'claude', name: 'My relay', baseUrl: 'https://y.example.com' })).rejects.toThrow('已经有')
  await expect(host.execute({ type: 'provider-save', app: 'claude', name: 'Plain', baseUrl: 'http://relay.example.com' })).rejects.toThrow('HTTPS')
  expect(host.snapshot().agents.mine.claude).toHaveLength(1)
  await host.close()
})

it('a key only goes to HTTPS, or to plain HTTP on this machine or the local network', () => {
  expect(providerEndpoint('https://api.example.com/v1/')).toBe('https://api.example.com/v1')
  for (const ok of ['http://localhost:11434', 'http://127.0.0.1:1234/v1', 'http://[::1]:8000', 'http://192.168.1.20:8000', 'http://10.0.0.2', 'http://172.20.0.5', 'http://nas.local:8080'])
    expect(() => providerEndpoint(ok), ok).not.toThrow()
  for (const bad of ['http://api.example.com', 'http://172.32.0.1', 'https://user:pass@api.example.com', 'https://api.example.com/?key=1', 'ftp://x', 'not a url'])
    expect(() => providerEndpoint(bad), bad).toThrow()
})

it('a universal provider: one gateway and key for all three apps, linked providers edited and deleted together', async () => {
  const { host, data, keys } = await setup()
  await host.execute({ type: 'universal-save', name: 'NewAPI', baseUrl: 'https://gw.example.com', key: 'sk-gw', apps: { claude: true, codex: true, gemini: false }, models: { claude: { model: 'claude-sonnet-5', haiku: 'claude-haiku-4-5' }, codex: { model: 'gpt-5.6', reasoningEffort: 'high' }, gemini: {} } })
  const agents = host.snapshot().agents
  expect(agents.universal).toEqual([expect.objectContaining({ name: 'NewAPI', baseUrl: 'https://gw.example.com', hasKey: true })])
  expect(agents.mine.claude).toEqual([expect.objectContaining({ name: 'NewAPI', source: 'universal', baseUrl: 'https://gw.example.com', model: 'claude-sonnet-5', hasKey: true })])
  // Codex speaks /v1/responses: a bare gateway origin gets /v1.
  expect(agents.mine.codex).toEqual([expect.objectContaining({ name: 'NewAPI', baseUrl: 'https://gw.example.com/v1', model: 'gpt-5.6' })])
  expect(agents.mine.gemini).toEqual([])
  expect(keys()).toEqual({ 'universal:NewAPI': 'sk-gw', 'claude:NewAPI': 'sk-gw', 'codex:NewAPI': 'sk-gw' })
  // A linked provider is edited through its universal one.
  await expect(host.execute({ type: 'provider-save', app: 'codex', name: 'NewAPI', previous: 'NewAPI', model: 'x' })).rejects.toThrow('统一')

  await host.execute({ type: 'agent-provider', agent: 'codex', provider: 'NewAPI' })
  const sent = host.execute({ type: 'send', text: '@codex 你好' })
  await vi.waitUntil(() => host.snapshot().approvals.length > 0, { timeout: 8000 })
  await host.execute({ type: 'approval', id: host.snapshot().approvals[0]!.id, allow: true })
  await sent
  const run = (await readFile(join(data, 'fake.log'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).at(-1)
  expect(run.args).toEqual(expect.arrayContaining(['model_providers.anna.base_url="https://gw.example.com/v1"', 'model="gpt-5.6"', 'model_reasoning_effort="high"']))
  expect(run.env.ANNA_PROVIDER_KEY).toBe('set')

  // Rename, drop Claude, add Gemini: Codex keeps using it under the new name, the key follows.
  await host.execute({ type: 'universal-save', previous: 'NewAPI', name: 'Gateway', baseUrl: 'https://gw.example.com/api/v1', apps: { claude: false, codex: true, gemini: true }, models: { codex: { model: 'gpt-5.6' }, gemini: { model: 'gemini-3.6-flash' } } })
  const after = host.snapshot().agents
  expect(after.mine.claude).toEqual([])
  expect(after.mine.codex).toEqual([expect.objectContaining({ name: 'Gateway', baseUrl: 'https://gw.example.com/api/v1' })])
  expect(after.mine.gemini).toEqual([expect.objectContaining({ name: 'Gateway', model: 'gemini-3.6-flash', hasKey: true })])
  expect(after.providers.codex?.provider).toBe('Gateway')
  expect(keys()).toEqual({ 'universal:Gateway': 'sk-gw', 'codex:Gateway': 'sk-gw', 'gemini:Gateway': 'sk-gw' })

  await host.execute({ type: 'universal-delete', name: 'Gateway' })
  expect(host.snapshot().agents.universal).toEqual([])
  expect(host.snapshot().agents.mine.codex).toEqual([])
  expect(host.snapshot().agents.providers.codex?.provider).toBeUndefined()
  expect(keys()).toEqual({})
  await host.close()
})

it('speed test: times the provider\'s address and its preset\'s other addresses, fastest first, with the same path', async () => {
  const seen: string[] = []
  // Only the speed test uses this fetch: it answers instantly for one host and fails for the rest.
  const { host } = await setup({ fetch: (async (url: string) => {
    seen.push(url)
    if (url.startsWith('https://cf.api.fan'))
      return new Response(null, { status: 404 })
    throw new TypeError('fetch failed')
  }) as typeof fetch })
  await host.execute({ type: 'provider-save', app: 'claude', name: 'PackyCode', from: 'PackyCode', baseUrl: 'https://www.packyapi.ai/claude' })
  await host.execute({ type: 'provider-speedtest', app: 'claude', name: 'PackyCode' })
  const results = host.snapshot().agents.speed['claude:PackyCode']!.results
  expect(results[0]).toMatchObject({ url: 'https://cf.api.fan/claude', status: 404, latency: expect.any(Number) })
  expect(results.slice(1).every(result => result.error === '连接失败')).toBe(true)
  expect(results.map(result => result.url)).toContain('https://www.packyapi.ai/claude')
  expect(new Set(seen)).toEqual(new Set(results.map(result => result.url)))
  await host.close()
})

it('balance: looked up with the provider\'s saved key, shown on its card; unsupported providers are not offered', async () => {
  const asked: string[] = []
  const { host } = await setup({ fetch: (async (url: string, init?: RequestInit) => {
    asked.push(`${url} ${(init?.headers as Record<string, string>).Authorization}`)
    return new Response(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '42.00' }] }))
  }) as typeof fetch })
  await host.execute({ type: 'provider-save', app: 'claude', name: 'DeepSeek', from: 'DeepSeek', key: 'sk-ds' })
  await host.execute({ type: 'provider-save', app: 'codex', name: 'Kimi', from: 'Kimi', key: 'sk-k' })
  expect(host.snapshot().agents.mine.claude![0]!.usage).toBe('balance')
  expect(host.snapshot().agents.mine.codex![0]!.usage).toBeUndefined()
  await host.execute({ type: 'provider-usage', app: 'claude', name: 'DeepSeek' })
  expect(asked).toEqual(['https://api.deepseek.com/user/balance Bearer sk-ds'])
  expect(host.snapshot().agents.usage['claude:DeepSeek']).toMatchObject({ kind: 'balance', balances: [{ remaining: 42, unit: 'CNY' }], at: expect.any(String) })
  await expect(host.execute({ type: 'provider-usage', app: 'codex', name: 'Kimi' })).rejects.toThrow('还不支持')
  await host.close()
})

it('import link: previewed with the key masked, confirmed into a free name with its key, optionally used; or cancelled', async () => {
  const { host, keys } = await setup()
  await host.execute({ type: 'provider-save', app: 'codex', name: 'Relay', baseUrl: 'https://old.example.com/v1', model: 'm' })
  const url = `ccswitch://v1/import?${new URLSearchParams({ resource: 'provider', app: 'codex', name: 'Relay', endpoint: 'https://relay.example.com/v1,https://relay2.example.com/v1', apiKey: 'sk-relay-123456', model: 'gpt-x' })}`
  await host.execute({ type: 'provider-link', link: url })
  expect(host.snapshot().agents.pendingImport).toMatchObject({ app: 'codex', name: 'Relay', key: 'sk-r••••3456' })
  expect(JSON.stringify(host.snapshot())).not.toContain('sk-relay-123456')
  await host.execute({ type: 'provider-link-confirm', use: true })
  expect(host.snapshot().agents.pendingImport).toBeUndefined()
  expect(host.snapshot().agents.mine.codex!.map(item => [item.name, item.baseUrl, item.hasKey])).toEqual([['Relay', 'https://old.example.com/v1', false], ['Relay 2', 'https://relay.example.com/v1', true]])
  expect(host.snapshot().agents.providers.codex?.provider).toBe('Relay 2')
  expect(keys()['codex:Relay 2']).toBe('sk-relay-123456')

  await host.execute({ type: 'provider-link', link: url })
  await host.execute({ type: 'provider-link-cancel' })
  expect(host.snapshot().agents.pendingImport).toBeUndefined()
  expect(host.snapshot().agents.mine.codex).toHaveLength(2)
  await expect(host.execute({ type: 'provider-link-confirm', use: false })).rejects.toThrow('没有待导入')
  await host.close()
})

it('export and import: keys only when asked for, names kept free, universal providers rebuilt, loader env vars dropped', async () => {
  const { host, data } = await setup()
  await host.execute({ type: 'provider-save', app: 'claude', name: 'DeepSeek', from: 'DeepSeek', key: 'sk-ds' })
  await host.execute({ type: 'universal-save', name: 'NewAPI', baseUrl: 'https://gw.example.com', key: 'sk-gw', apps: { claude: true, codex: false, gemini: false }, models: {} })
  const plain = join(data, 'plain.json')
  const withKeys = join(data, 'keys.json')
  await host.execute({ type: 'providers-export', includeKeys: false, path: plain })
  await host.execute({ type: 'providers-export', includeKeys: true, path: withKeys })
  expect(await readFile(plain, 'utf8')).not.toContain('sk-')
  const exported = JSON.parse(await readFile(withKeys, 'utf8'))
  expect(exported).toMatchObject({ format: 'anna-providers', version: 1, keys: { 'claude:DeepSeek': 'sk-ds', 'universal:NewAPI': 'sk-gw' } })
  expect(exported.providers.map((item: { name: string }) => item.name)).toEqual(['DeepSeek'])
  if (process.platform !== 'win32')
    expect((await import('node:fs')).statSync(withKeys).mode & 0o777).toBe(0o600)
  await host.close()

  // Another machine: an imported file with a hostile env var, into a list that already has a DeepSeek.
  exported.providers[0].preset.env.NODE_OPTIONS = '--require /tmp/x.js'
  await writeFile(withKeys, JSON.stringify(exported))
  const other = await setup()
  await other.host.execute({ type: 'provider-save', app: 'claude', name: 'DeepSeek', from: 'DeepSeek' })
  await other.host.execute({ type: 'providers-import', path: withKeys })
  const mine = other.host.snapshot().agents.mine.claude!
  expect(mine.map(item => [item.name, item.source, item.hasKey])).toEqual([['DeepSeek', 'preset', false], ['NewAPI', 'universal', true], ['DeepSeek 2', 'preset', true]])
  expect(JSON.stringify(other.host.snapshot().settings)).not.toContain('NODE_OPTIONS')
  expect(other.keys()).toMatchObject({ 'claude:DeepSeek 2': 'sk-ds', 'universal:NewAPI': 'sk-gw', 'claude:NewAPI': 'sk-gw' })
  await expect(other.host.execute({ type: 'providers-import', path: plain.replace('plain', 'missing') })).rejects.toThrow('JSON')
  await other.host.close()
})

it('the companion works providers with anna_providers: reads freely, switches only after the user says yes', async () => {
  const { host, data } = await setup({ characterId: 'mark', script: [
    { tools: [{ name: 'anna_providers', args: { action: 'list' } }] },
    { tools: [{ name: 'anna_providers', args: { action: 'use', app: 'codex', name: 'DeepSeek' } }] },
    { tools: [{ name: 'anna_providers', args: { action: 'global', app: 'codex', name: 'DeepSeek' } }] },
    { text: '好的。' },
  ] })
  await host.execute({ type: 'provider-save', app: 'codex', name: 'DeepSeek', from: 'DeepSeek', key: 'sk-secret-ds' })
  const sent = host.execute({ type: 'send', text: '把 Codex 换成 DeepSeek' })
  await vi.waitUntil(() => host.snapshot().approvals.length > 0, { timeout: 8000 })
  const card = host.snapshot().approvals[0]!
  expect(card).toMatchObject({ toolName: 'anna_providers', danger: false, details: 'Codex → DeepSeek' })
  expect(card.reason).toContain('马克君')
  await host.execute({ type: 'approval', id: card.id, allow: true })
  // The global switch rewrites Codex's own config: a risky card, declined here.
  await vi.waitUntil(() => host.snapshot().approvals[0]?.danger === true, { timeout: 8000 })
  await host.execute({ type: 'approval', id: host.snapshot().approvals[0]!.id, allow: false })
  await sent
  expect(host.snapshot().agents.providers.codex?.provider).toBe('DeepSeek')
  expect(host.snapshot().agents.global.codex?.switched).toBeFalsy()
  // What the model saw (the session log holds the tool results): the list without the key, and the outcomes.
  const { readdir } = await import('node:fs/promises')
  const sessions = join(data, 'pi-sessions')
  const files = (await readdir(sessions, { recursive: true })).filter(file => String(file).endsWith('.jsonl'))
  const seen = (await Promise.all(files.map(file => readFile(join(sessions, String(file)), 'utf8')))).join('\n')
  expect(seen).toContain('DeepSeek：https://api.deepseek.com，模型 deepseek-flash，已存密钥，可查余额')
  expect(seen).toContain('好了：Codex 之后派活和当大脑时用DeepSeek')
  expect(seen).toContain('用户没有同意')
  expect(seen).not.toContain('sk-secret-ds')
  await host.close()
})
