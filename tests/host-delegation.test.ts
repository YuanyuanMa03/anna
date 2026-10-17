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

/** A host whose external agents are the protocol-faithful fake (tests/fixtures/fake-agent.mjs). */
async function setup(script: ScriptStep[], mode: PermissionMode = 'ask') {
  const data = await mkdtemp(join(tmpdir(), 'anna-delegate-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  await writeFile(join(workspace, 'README.md'), '# demo\n')
  const log = join(data, 'fake.log')
  process.env.ANNA_FAKE_LOG = log
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'hiyori', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode, rules: { allow: [], ask: [], deny: [] } } } }))
  const backend = await scriptedBackend(script, data)
  const events: AnnaEvent[] = []
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, event => events.push(event), {
    sandbox: { available: false, reason: 'test' },
    kernel: context => createPiKernel(context, backend),
    agents: { locate: agent => ({ command: process.execPath, prefix: [fake, agent] }) },
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

it('anna decides to delegate with anna_delegate: asks first in ask mode, then relays the result', async () => {
  const { host, workspace } = await setup([
    { tools: [{ name: 'anna_delegate', args: { agent: 'claude', task: '创建 done.txt' } }] },
    { text: 'Claude Code 已经替你创建好了 done.txt。' },
  ])
  const sent = host.execute({ type: 'send', text: '找个合适的 agent 帮我创建 done.txt' })
  const ask = await approve(host)
  expect(ask).toMatchObject({ toolName: 'anna_delegate', reason: expect.stringContaining('Claude Code') })
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
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'hiyori', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'auto', rules: { allow: [], ask: [], deny: [] } } } }))
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
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'claude-code', characterId: 'hiyori', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'ask', rules: { allow: [], ask: [], deny: [] } } } }))
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
