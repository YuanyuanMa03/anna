import type { ScriptStep } from '../packages/kernels/pi/backend'
import type { AnnaEvent, PermissionMode } from '../packages/shared/contracts'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { expect, it, vi } from 'vitest'
import { Host } from '../packages/anna-host/host'
import { scriptedBackend } from '../packages/kernels/pi/backend'
import { createPiKernel } from '../packages/kernels/pi/kernel'

const fake = resolve('tests/fixtures/fake-agent.mjs')

/**
 * A host whose external agents are the protocol-faithful fake (tests/fixtures/fake-agent.mjs).
 * `review` is written to the settings (undefined keeps the default, on); `installed: false` hides the agents.
 */
async function setup(script: ScriptStep[], mode: PermissionMode = 'ask', options: { review?: boolean, installed?: boolean, characterId?: string } = { review: false }) {
  const data = await mkdtemp(join(tmpdir(), 'anna-delegate-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  await writeFile(join(workspace, 'README.md'), '# demo\n')
  const log = join(data, 'fake.log')
  process.env.ANNA_FAKE_LOG = log
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: options.characterId ?? 'haru', statusEnabled: false, memoryEnabled: false, reviewDelegations: options.review, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode, rules: { allow: [], ask: [], deny: [] } } } }))
  const backend = await scriptedBackend(script, data)
  const events: AnnaEvent[] = []
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, event => events.push(event), {
    sandbox: { available: false, reason: 'test' },
    kernel: context => createPiKernel(context, backend),
    agents: { locate: agent => options.installed === false ? undefined : { command: process.execPath, prefix: [fake, agent] } },
  })
  await host.initialize()
  const runs = async () => (existsSync(log) ? (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) : [])
  return { host, data, workspace, events, runs }
}
async function approve(host: Host, allow = true) {
  await vi.waitUntil(() => host.snapshot().approvals.length > 0, { timeout: 8000, interval: 20 })
  const question = host.snapshot().approvals[0]!
  await host.execute({ type: 'approval', id: question.id, allow })
  return question
}

it('@claude: delegates, forwards its permission request to Anna\'s card, records changes, undoes, and resumes', async () => {
  const { host, data, workspace, events, runs } = await setup([])
  const sent = host.execute({ type: 'send', text: '@claude 帮我创建 done.txt' })
  const question = await approve(host)
  expect(question).toMatchObject({ toolName: 'write', details: 'done.txt', origin: 'desktop' })
  await sent
  expect(await readFile(join(workspace, 'done.txt'), 'utf8')).toBe('OK')
  const snapshot = host.snapshot()
  expect(snapshot.result).toMatchObject({ status: 'completed', changes: [{ path: 'done.txt', status: 'added' }] })
  expect(snapshot.messages!.at(-1)).toMatchObject({ role: 'assistant', delegation: { agent: 'claude', status: 'completed' } })
  expect(snapshot.messages!.at(-1)!.text).toContain('已创建 done.txt')
  expect(events.some(event => event.type === 'collaborator' && event.agent === 'claude')).toBe(true)
  expect(events.filter(event => event.type === 'anna').map(event => event.type === 'anna' && event.state.phase)).toContain('supervising')
  // The task journal credits Claude Code, so a later session does not claim the change as the companion's own.
  expect(JSON.parse(await readFile(join(data, 'journal.json'), 'utf8')).at(-1)).toMatchObject({ by: ['Claude Code'], changes: [{ path: 'done.txt', status: 'added' }] })

  await host.execute({ type: 'undo', taskId: snapshot.result!.taskId })
  expect(existsSync(join(workspace, 'done.txt'))).toBe(false)

  const again = host.execute({ type: 'send', text: '@claude 再创建一次' })
  await approve(host)
  await again
  expect((await runs()).at(-1).args).toEqual(expect.arrayContaining(['--resume', 'fake-claude-session-1']))
  expect(host.snapshot().messages!.at(-1)!.text).toContain('续接')
  await host.close()
})

it('@claude with the pi brain: the companion reviews the result in a hidden turn, read-only, before reporting', async () => {
  const { host, workspace, events } = await setup([
    { tools: [{ name: 'write', args: { path: 'done.txt', content: 'changed by the reviewer' } }] },
    { tools: [{ name: 'read', args: { path: 'done.txt' } }] },
    { text: '我看过了：done.txt 已创建，内容是 OK，可以放心用。' },
  ], 'ask', {})
  const sent = host.execute({ type: 'send', text: '@claude 帮我创建 done.txt' })
  await approve(host)
  await sent
  // The review cannot change files; the collaborator's work stays as it left it.
  expect(await readFile(join(workspace, 'done.txt'), 'utf8')).toBe('OK')
  const visible = (messages: { role: string, text: string, delegation?: unknown }[]) => messages.map(message => [message.role, message.delegation ? 'delegation' : message.text])
  const expected = [['user', '@claude 帮我创建 done.txt'], ['assistant', 'delegation'], ['assistant', '我看过了：done.txt 已创建，内容是 OK，可以放心用。']]
  expect(visible(host.snapshot().messages!)).toEqual(expected)
  expect(host.snapshot().result).toMatchObject({ status: 'completed', summary: '我看过了：done.txt 已创建，内容是 OK，可以放心用。', changes: [{ path: 'done.txt', status: 'added' }] })
  const phases = events.flatMap(event => event.type === 'anna' ? [event.state.phase] : [])
  expect(phases.indexOf('reviewing')).toBeGreaterThan(phases.indexOf('supervising'))
  expect(events.some(event => event.type === 'tool' && event.name === 'write' && event.phase === 'result' && event.isError)).toBe(true)
  // The hidden prompt stays hidden after a restart rebuilds the history from the session file.
  await host.execute({ type: 'restart' })
  expect(visible(host.snapshot().messages!)).toEqual(expected)
  await host.close()
})

it('no review after a failed delegation, or when the user turned reviews off', async () => {
  const failed = await setup([{ text: '不该出现的审阅。' }], 'ask', { installed: false })
  await expect(failed.host.execute({ type: 'send', text: '@claude 帮我创建 done.txt' })).rejects.toThrow()
  expect(failed.host.snapshot().messages!.at(-1)).toMatchObject({ delegation: { agent: 'claude', status: 'failed' } })
  expect(failed.host.snapshot().messages!.some(message => message.text.includes('不该出现'))).toBe(false)
  expect(failed.events.some(event => event.type === 'anna' && event.state.phase === 'reviewing')).toBe(false)
  await failed.host.close()

  const off = await setup([{ text: '不该出现的审阅。' }], 'auto', {})
  await off.host.execute({ type: 'review', enabled: false })
  expect(off.host.snapshot().settings.reviewDelegations).toBe(false)
  await off.host.execute({ type: 'send', text: '@claude 帮我创建 done.txt' })
  expect(off.host.snapshot().messages!.at(-1)).toMatchObject({ delegation: { agent: 'claude', status: 'completed' } })
  expect(off.events.some(event => event.type === 'anna' && event.state.phase === 'reviewing')).toBe(false)
  await off.host.close()
})

it('@codex: a declined command is reported, nothing is written', async () => {
  const { host, workspace } = await setup([], 'edit')
  const sent = host.execute({ type: 'send', text: '@codex 用命令创建 done.txt' })
  const question = await approve(host, false)
  expect(question).toMatchObject({ toolName: 'bash', details: 'printf OK > done.txt' })
  await sent
  expect(existsSync(join(workspace, 'done.txt'))).toBe(false)
  expect(host.snapshot().result).toMatchObject({ failedTools: 1 })
  expect(host.snapshot().messages!.at(-1)).toMatchObject({ delegation: { agent: 'codex' } })
  await host.close()
})

it('the companion decides to delegate with anna_delegate: asks first in ask mode, in its own name, then relays the result', async () => {
  const { host, workspace } = await setup([
    { tools: [{ name: 'anna_delegate', args: { agent: 'claude', task: '创建 done.txt' } }] },
    { text: 'Claude Code 已经替你创建好了 done.txt。' },
  ], 'ask', { review: false, characterId: 'mark' })
  const sent = host.execute({ type: 'send', text: '找个合适的 agent 帮我创建 done.txt' })
  const ask = await approve(host)
  expect(ask).toMatchObject({ toolName: 'anna_delegate', reason: expect.stringContaining('Claude Code') })
  // The card speaks for whoever is on stage, not for Anna.
  expect(ask.reason).toContain('马克君')
  expect(ask.reason).not.toContain('Anna')
  const write = await approve(host)
  expect(write.toolName).toBe('write')
  await sent
  expect(existsSync(join(workspace, 'done.txt'))).toBe(true)
  expect(host.snapshot().messages!.at(-1)!.text).toBe('Claude Code 已经替你创建好了 done.txt。')
  await host.close()
})

it('manages agents like cc-switch: detection list, per-agent provider for delegation, global switch and restore, import', async () => {
  const data = await mkdtemp(join(tmpdir(), 'anna-agents-'))
  const workspace = join(data, 'project')
  const claudeDir = join(data, 'home', '.claude')
  await mkdir(workspace, { recursive: true })
  await mkdir(claudeDir, { recursive: true })
  await writeFile(join(claudeDir, 'settings.json'), JSON.stringify({ env: { FOO: '1' }, model: 'opus' }, null, 2))
  const log = join(data, 'fake.log')
  process.env.ANNA_FAKE_LOG = log
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'haru', statusEnabled: false, memoryEnabled: false, reviewDelegations: false, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'auto', rules: { allow: [], ask: [], deny: [] } } } }))
  const secrets: Record<string, string> = {}
  const backend = await scriptedBackend([], data)
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, () => {}, {
    sandbox: { available: false, reason: 'test' },
    kernel: context => createPiKernel(context, backend),
    secrets: { read: async () => secrets.providers ?? '', write: async (value) => { secrets.providers = value } },
    agents: {
      locate: agent => ({ command: process.execPath, prefix: [fake, agent] }),
      detect: async () => [{ id: 'claude', label: 'Claude Code', tier: 'delegate', installed: true, path: '/x/claude', version: '2.1.302', loggedIn: true, configured: true, configDir: claudeDir }],
      configDirs: { claude: claudeDir, codex: join(data, 'home', '.codex'), gemini: join(data, 'home', '.gemini') },
    },
  })
  await host.initialize()
  await host.execute({ type: 'agents-refresh' })
  expect(host.snapshot().agents.detected).toEqual([expect.objectContaining({ id: 'claude', installed: true, version: '2.1.302', approvals: 'forwarded', verified: true })])

  await host.execute({ type: 'agent-provider', agent: 'claude', provider: 'DeepSeek', key: 'sk-ds-secret' })
  expect(JSON.stringify(host.snapshot().settings)).not.toContain('sk-ds-secret')
  expect(secrets.providers).toContain('sk-ds-secret')
  expect(host.snapshot().agents.providers.claude).toMatchObject({ provider: 'DeepSeek', hasKey: true })
  await host.execute({ type: 'send', text: '@claude 创建 done.txt' })
  const run = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).at(-1)
  expect(run.env.ANTHROPIC_BASE_URL).toMatch(/deepseek/)

  await host.execute({ type: 'provider-global', app: 'claude', provider: 'DeepSeek' })
  const switched = JSON.parse(await readFile(join(claudeDir, 'settings.json'), 'utf8'))
  expect(switched).toMatchObject({ model: 'opus', env: { FOO: '1', ANTHROPIC_BASE_URL: expect.stringMatching(/deepseek/) } })
  expect(host.snapshot().agents.global.claude).toMatchObject({ switched: true, provider: 'DeepSeek' })
  await host.execute({ type: 'provider-restore', app: 'claude' })
  expect(JSON.parse(await readFile(join(claudeDir, 'settings.json'), 'utf8'))).toEqual({ env: { FOO: '1' }, model: 'opus' })
  await host.close()
})

it('switching Anna\'s brain to Claude Code: plain messages go to it, with Anna\'s persona, approvals, history and resume', async () => {
  const data = await mkdtemp(join(tmpdir(), 'anna-brain-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  const log = join(data, 'fake.log')
  process.env.ANNA_FAKE_LOG = log
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'claude-code', characterId: 'haru', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'ask', rules: { allow: [], ask: [], deny: [] } } } }))
  const make = () => new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, () => {}, {
    sandbox: { available: false, reason: 'test' },
    agents: { locate: agent => ({ command: process.execPath, prefix: [fake, agent] }) },
  })
  const host = make()
  await host.initialize()
  const sent = host.execute({ type: 'send', text: '帮我创建 done.txt' })
  expect((await approve(host)).toolName).toBe('write')
  await sent
  expect(host.snapshot().kernel.id).toBe('claude-code')
  expect(host.snapshot().messages!.map(message => [message.role, message.text])).toEqual([['user', '帮我创建 done.txt'], ['assistant', '已创建 done.txt。']])
  const first = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).at(-1)
  expect(first.args[first.args.indexOf('--append-system-prompt') + 1]).toContain('Anna')
  await host.close()

  const again = make()
  await again.initialize()
  await again.execute({ type: 'connect' })
  expect(again.snapshot().messages).toHaveLength(2)
  const resumed = again.execute({ type: 'send', text: '再来一次' })
  await approve(again)
  await resumed
  expect((await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).at(-1).args).toEqual(expect.arrayContaining(['--resume', 'fake-claude-session-1']))
  expect(again.snapshot().messages).toHaveLength(4)
  await again.close()
})

it.each([['claude-code', 'claude'], ['codex', 'codex']] as const)('with %s as the brain, the shared diary and Anna\'s other tools still work, over a local MCP server', async (kernel, agent) => {
  const data = await mkdtemp(join(tmpdir(), 'anna-brain-tools-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  const log = join(data, 'fake.log')
  process.env.ANNA_FAKE_LOG = log
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel, characterId: 'mark', statusEnabled: true, memoryEnabled: true, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'ask', rules: { allow: [], ask: [], deny: [] } } } }))
  const events: AnnaEvent[] = []
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, event => events.push(event), {
    sandbox: { available: false, reason: 'test' },
    agents: { locate: agent => ({ command: process.execPath, prefix: [fake, agent] }) },
  })
  await host.initialize()
  // Anna's own tools pass her gate without a card, as they do on the pi brain.
  await host.execute({ type: 'send', text: '记住：我喜欢绿茶' })
  expect(host.snapshot().approvals).toEqual([])
  expect(host.snapshot().memories.map(item => item.text)).toEqual(['我喜欢绿茶'])
  expect(host.snapshot().messages!.at(-1)).toMatchObject({ role: 'assistant', text: '已记住：我喜欢绿茶' })
  // The stage shows the companion looking through the diary, not "using mcp__anna__…".
  expect(events.some(event => event.type === 'anna' && event.state.line === '正在翻看记忆')).toBe(true)
  const run = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).at(-1)
  expect(run.agent).toBe(agent)
  if (agent === 'claude')
    expect(run.args[run.args.indexOf('--append-system-prompt') + 1]).toContain('mcp__anna__anna_memory')
  const server = agent === 'claude'
    ? (({ url, headers }) => ({ url, authorization: headers.Authorization }))(JSON.parse(run.args[run.args.indexOf('--mcp-config') + 1]).mcpServers.anna)
    : { url: JSON.parse(run.args.find((arg: string) => arg.startsWith('mcp_servers.anna.url=')).split('=')[1]), authorization: /"(.*)"/.exec(run.args.find((arg: string) => arg.startsWith('mcp_servers.anna.http_headers=')))![1] }
  const listed = await (await fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': server.authorization }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).json()
  expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['anna_status', 'anna_memory', 'anna_delegate', 'anna_providers'])
  // The server lives as long as the kernel: once Anna closes, nothing answers on its port.
  await host.close()
  await expect(fetch(server.url, { method: 'POST' })).rejects.toThrow()
})

it('with Claude Code as the brain, the companion can still hand work to Codex through anna_delegate, asking first in ask mode', async () => {
  const data = await mkdtemp(join(tmpdir(), 'anna-brain-delegate-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  process.env.ANNA_FAKE_LOG = join(data, 'fake.log')
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'claude-code', characterId: 'mark', statusEnabled: false, memoryEnabled: false, reviewDelegations: false, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'ask', rules: { allow: [], ask: [], deny: [] } } } }))
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, () => {}, {
    sandbox: { available: false, reason: 'test' },
    agents: { locate: agent => ({ command: process.execPath, prefix: [fake, agent] }) },
  })
  await host.initialize()
  const sent = host.execute({ type: 'send', text: '交给 codex：创建 done.txt' })
  const ask = await approve(host)
  expect(ask).toMatchObject({ toolName: 'anna_delegate', reason: expect.stringContaining('Codex') })
  const command = await approve(host)
  expect(command.toolName).toBe('bash')
  await sent
  expect(await readFile(join(workspace, 'done.txt'), 'utf8')).toBe('OK')
  expect(host.snapshot().messages!.at(-1)!.text).toContain('[Codex 的结果，状态：completed]')
  expect(host.snapshot().result).toMatchObject({ changes: [{ path: 'done.txt', status: 'added' }] })
  await host.close()
})

it('the Codex brain uses the provider chosen for Codex (DeepSeek here), with the key only in its environment', async () => {
  const data = await mkdtemp(join(tmpdir(), 'anna-brain-provider-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  const log = join(data, 'fake.log')
  process.env.ANNA_FAKE_LOG = log
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'codex', characterId: 'haru', statusEnabled: false, memoryEnabled: true, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'ask', rules: { allow: [], ask: [], deny: [] } } } }))
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, () => {}, {
    sandbox: { available: false, reason: 'test' },
    agents: { locate: agent => ({ command: process.execPath, prefix: [fake, agent] }) },
  })
  await host.initialize()
  await host.execute({ type: 'agent-provider', agent: 'codex', provider: 'DeepSeek', key: 'sk-deepseek-test' })
  await host.execute({ type: 'send', text: '记住：我喜欢绿茶' })
  expect(host.snapshot().memories.map(item => item.text)).toEqual(['我喜欢绿茶'])
  const run = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).at(-1)
  expect(run.args).toEqual(expect.arrayContaining(['model_provider="anna"', 'model_providers.anna.base_url="https://api.deepseek.com"', 'model_providers.anna.wire_api="responses"', 'model="deepseek-flash"']))
  expect(run.env.ANNA_PROVIDER_KEY).toBe('set')
  expect(JSON.stringify(run.args)).not.toContain('sk-deepseek-test')
  // The model catalog was written before Codex started, where its arguments point.
  const catalog = JSON.parse(run.args.find((arg: string) => arg.startsWith('model_catalog_json=')).slice('model_catalog_json='.length)) as string
  expect(JSON.parse(await readFile(catalog, 'utf8')).models[0].slug).toBe('deepseek-flash')
  await host.close()
})

it('an external brain\'s transcript survives saves that overlap (a delegation recorded mid-turn, then the turn\'s end)', async () => {
  const { ExternalKernel } = await import('../packages/kernels/external/kernel')
  const data = await mkdtemp(join(tmpdir(), 'anna-external-save-'))
  const kernel = new ExternalKernel({ root: '.', data, workspace: data, trusted: true, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, key: '', instructions: [], gate: async () => ({ allow: true }), tools: [], emit: () => {} }, 'claude')
  for (let index = 0; index < 20; index++) kernel.remember('delegation', { task: `t${index}`, text: 'ok', delegation: { agent: 'codex', label: 'Codex', task: `t${index}`, status: 'completed', steps: 0 }, nested: true })
  await (kernel as unknown as { save: () => Promise<void> }).save()
  const saved = JSON.parse(await readFile(kernel.sessionFile, 'utf8'))
  expect(saved.entries).toHaveLength(20)
})
