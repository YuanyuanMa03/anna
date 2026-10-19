import type { Server } from 'node:http'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { Host } from '../packages/anna-host/host'
import { scriptedBackend } from '../packages/kernels/pi/backend'
import { createPiKernel } from '../packages/kernels/pi/kernel'

/** Global routing end to end: the agents' own configs point at Anna, follow her choices, and go back on quit. */

let upstream: Server
let base: string
const hits: { name: string, path: string, authorization?: string, model?: string }[] = []
beforeAll(async () => {
  upstream = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk) => { text += chunk })
    request.on('end', () => {
      const name = request.url!.split('/')[1]!
      hits.push({ name, path: request.url!, authorization: request.headers.authorization, model: text ? JSON.parse(text).model : undefined })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ id: 'c', choices: [{ delta: { content: `from ${name}` }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
    })
  })
  await new Promise<void>(done => upstream.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
})
afterAll(() => {
  upstream.closeAllConnections()
  upstream.close()
})

async function freePort() {
  const probe = createServer()
  await new Promise<void>(done => probe.listen(0, '127.0.0.1', done))
  const { port } = probe.address() as { port: number }
  await new Promise(done => probe.close(done))
  return port
}

async function setup(data?: string, port?: number) {
  data ??= await mkdtemp(join(tmpdir(), 'anna-global-routing-'))
  const workspace = join(data, 'project')
  const configs = { claude: join(data, 'home/.claude'), codex: join(data, 'home/.codex'), gemini: join(data, 'home/.gemini') }
  await mkdir(workspace, { recursive: true })
  await mkdir(configs.codex, { recursive: true })
  await mkdir(configs.claude, { recursive: true })
  try { await readFile(join(data, 'settings.json')) }
  catch { await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'haru', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'auto', rules: { allow: [], ask: [], deny: [] } } } })) }
  const secretsFile = join(data, 'test-secrets.json')
  const backend = await scriptedBackend([], data)
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, () => {}, {
    sandbox: { available: false, reason: 'test' },
    kernel: context => createPiKernel(context, backend),
    secrets: { read: async () => readFile(secretsFile, 'utf8').catch(() => ''), write: async (value) => { await writeFile(secretsFile, value) } },
    agents: { locate: agent => ({ command: process.execPath, prefix: [resolve('tests/fixtures/fake-agent.mjs'), agent] }), detect: async () => [], configDirs: configs, routingPort: port ?? await freePort() },
  })
  await host.initialize()
  return { host, data, configs }
}

const toml = (text: string, key: string) => new RegExp(`^${key} = "([^"]*)"`, 'm').exec(text)?.[1]

it('codex in a terminal goes through Anna: the config points at the route, follows the provider in use, and goes back on quit', async () => {
  const { host, data, configs } = await setup()
  const original = 'model = "gpt-6"\napproval_policy = "on-request"\n'
  await writeFile(join(configs.codex, 'config.toml'), original)
  await host.execute({ type: 'provider-save', app: 'codex', name: 'Chat A', baseUrl: `${base}/a/v1`, model: 'model-a', key: 'sk-a', apiFormat: 'openai_chat' })
  await host.execute({ type: 'provider-save', app: 'codex', name: 'Chat B', baseUrl: `${base}/b/v1`, model: 'model-b', key: 'sk-b', apiFormat: 'openai_chat' })
  await expect(host.execute({ type: 'provider-routing', app: 'codex', on: true })).rejects.toThrow('先在这里选一个服务商')
  expect(await readFile(join(configs.codex, 'config.toml'), 'utf8')).toBe(original)
  await host.execute({ type: 'agent-provider', agent: 'codex', provider: 'Chat A' })
  await host.execute({ type: 'provider-routing', app: 'codex', on: true })
  const config = await readFile(join(configs.codex, 'config.toml'), 'utf8')
  const url = toml(config, 'base_url')!
  const token = toml(config, 'experimental_bearer_token')!
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/codex\/v1$/)
  expect(host.snapshot().agents.global.codex).toMatchObject({ routing: { url } })
  expect(config).toContain('approval_policy = "on-request"')
  expect(toml(config, 'model')).toBe('model-a')
  expect(config).not.toContain('sk-a')
  // What the terminal's Codex would send, with the token from its own config.
  const ask = async () => (await fetch(`${url}/responses`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ model: 'model-a', input: 'hi', stream: true }) })).text()
  expect(await ask()).toContain('from a')
  expect(hits.at(-1)).toMatchObject({ name: 'a', authorization: 'Bearer sk-a', model: 'model-a' })
  // Switching the provider in Anna moves the terminal too; the token stays.
  await host.execute({ type: 'agent-provider', agent: 'codex', provider: 'Chat B' })
  const switched = await readFile(join(configs.codex, 'config.toml'), 'utf8')
  expect(toml(switched, 'model')).toBe('model-b')
  expect(toml(switched, 'experimental_bearer_token')).toBe(token)
  expect(await ask()).toContain('from b')
  // No direct global switch while routed.
  await expect(host.execute({ type: 'provider-global', app: 'codex', provider: 'Chat B' })).rejects.toThrow('路由')
  // Quit: the config goes back; the setting stays for the next start.
  await host.close()
  expect(await readFile(join(configs.codex, 'config.toml'), 'utf8')).toBe(original)
  const again = await setup(data, Number(new URL(url).port))
  expect(toml(await readFile(join(configs.codex, 'config.toml'), 'utf8'), 'experimental_bearer_token')).toBe(token)
  await again.host.execute({ type: 'provider-routing', app: 'codex', on: false })
  expect(await readFile(join(configs.codex, 'config.toml'), 'utf8')).toBe(original)
  expect(again.host.snapshot().agents.global.codex).not.toHaveProperty('routing')
  await again.host.close()
})

it('claude Code in a terminal: the route, a token, Claude tier names; after a crash the next start sorts it out', async () => {
  const { host, data, configs } = await setup()
  await writeFile(join(configs.claude, 'settings.json'), `${JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'sk-mine' } }, null, 2)}\n`)
  await host.execute({ type: 'provider-save', app: 'claude', name: 'Chat C', baseUrl: `${base}/c`, model: 'model-c', key: 'sk-c', apiFormat: 'openai_chat' })
  await host.execute({ type: 'agent-provider', agent: 'claude', provider: 'Chat C' })
  await host.execute({ type: 'provider-routing', app: 'claude', on: true })
  const env = JSON.parse(await readFile(join(configs.claude, 'settings.json'), 'utf8')).env
  expect(env).toMatchObject({ ANTHROPIC_BASE_URL: expect.stringMatching(/\/claude$/), ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5', ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: 'model-c' })
  const response = await fetch(`${env.ANTHROPIC_BASE_URL}/v1/messages`, { method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_AUTH_TOKEN }, body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hi' }] }) })
  expect(await response.text()).toContain('from c')
  expect(hits.at(-1)).toMatchObject({ name: 'c', path: '/c/v1/chat/completions', authorization: 'Bearer sk-c', model: 'model-c' })
  // A crash: no close. Routing switched off meanwhile (as if by an older settings file): the next start gives the config back.
  const settings = JSON.parse(await readFile(join(data, 'settings.json'), 'utf8'))
  settings.routing.global.claude = false
  await writeFile(join(data, 'settings.json'), JSON.stringify(settings))
  const again = await setup(data)
  expect(JSON.parse(await readFile(join(configs.claude, 'settings.json'), 'utf8'))).toEqual({ env: { ANTHROPIC_AUTH_TOKEN: 'sk-mine' } })
  await again.host.close()
})

it('failover settings per agent: checked, saved, and back to the defaults with an empty policy', async () => {
  const { host } = await setup()
  expect(host.snapshot().agents.routingPolicies?.claude).toEqual({ maxRetries: 6, firstByteTimeout: 90, idleTimeout: 180, failureThreshold: 8, openSeconds: 90 })
  await host.execute({ type: 'routing-policy', app: 'codex', policy: { firstByteTimeout: 30, maxRetries: 1 } })
  expect(host.snapshot().agents.routingPolicies?.codex).toMatchObject({ firstByteTimeout: 30, maxRetries: 1, idleTimeout: 120 })
  await expect(host.execute({ type: 'routing-policy', app: 'codex', policy: { maxRetries: 99 } })).rejects.toThrow('0 到 10')
  await host.execute({ type: 'routing-policy', app: 'codex', policy: {} })
  expect(host.snapshot().agents.routingPolicies?.codex.firstByteTimeout).toBe(60)
  await host.close()
})

it('the backup queue and routing settings survive a restart (the settings schema keeps them)', async () => {
  const { host, data } = await setup()
  for (const name of ['One', 'Two'])
    await host.execute({ type: 'provider-save', app: 'codex', name, baseUrl: `${base}/${name}/v1`, model: 'm', key: 'k', apiFormat: 'openai_chat' })
  await host.execute({ type: 'agent-provider', agent: 'codex', provider: 'One' })
  await host.execute({ type: 'provider-backups', app: 'codex', names: ['Two'] })
  await host.execute({ type: 'routing-policy', app: 'claude', policy: { openSeconds: 30 } })
  await host.close()
  const again = await setup(data)
  expect(again.host.snapshot().agents.providers.codex).toMatchObject({ provider: 'One', backups: ['Two'] })
  expect(again.host.snapshot().agents.routingPolicies?.claude.openSeconds).toBe(30)
  await again.host.close()
})
