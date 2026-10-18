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

async function setup() {
  const data = await mkdtemp(join(tmpdir(), 'anna-providers-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  process.env.ANNA_FAKE_LOG = join(data, 'fake.log')
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'hiyori', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'auto', rules: { allow: [], ask: [], deny: [] } } } }))
  const secrets: Record<string, string> = {}
  const backend = await scriptedBackend([], data)
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, () => {}, {
    sandbox: { available: false, reason: 'test' },
    kernel: context => createPiKernel(context, backend),
    secrets: { read: async () => secrets.providers ?? '', write: async (value) => { secrets.providers = value } },
    agents: { locate: agent => ({ command: process.execPath, prefix: [fake, agent] }), detect: async () => [] },
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
