import { describe, expect, it } from 'vitest'
import { detectAgents } from '../packages/agents/detect'
import { nodeEnvironment } from '../packages/agents/node-environment'

/** Real-machine checks (S8). Opt in with ANNA_REAL_AGENTS=claude,codex — they use the installed CLIs. */
const wanted = (process.env.ANNA_REAL_AGENTS ?? '').split(',').filter(Boolean)

describe.skipIf(!wanted.length)('real agents on this machine', () => {
  it('detects the installed CLIs even with a GUI-style PATH', async () => {
    const env = nodeEnvironment()
    const agents = await detectAgents({ ...env, env: { ...env.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } })
    for (const id of wanted)
      expect(agents.find(agent => agent.id === id), id).toMatchObject({ installed: true, loggedIn: true, version: expect.stringMatching(/^\d+\.\d+/) })
  }, 30000)
})

describe.skipIf(!wanted.length)('real delegation through the Host', () => {
  it.each(wanted)('%s: creates a file after Anna approves its request, result card and resume', async (agent) => {
    const { mkdir, mkdtemp, readFile, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join, resolve } = await import('node:path')
    const { vi } = await import('vitest')
    const { Host } = await import('../packages/anna-host/host')
    const { scriptedBackend } = await import('../packages/kernels/pi/backend')
    const { createPiKernel } = await import('../packages/kernels/pi/kernel')
    const data = await mkdtemp(join(tmpdir(), `anna-real-${agent}-`))
    const workspace = join(data, 'project')
    await mkdir(workspace)
    await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'haru', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'ask', rules: { allow: [], ask: [], deny: [] } } } }))
    const backend = await scriptedBackend([], data)
    const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, () => {}, { sandbox: { available: false, reason: 'test' }, kernel: context => createPiKernel(context, backend) })
    await host.initialize()
    await host.execute({ type: 'agents-refresh' })
    let approvals = 0
    const timer = setInterval(() => {
      for (const question of host.snapshot().approvals) {
        approvals++
        void host.execute({ type: 'approval', id: question.id, allow: true })
      }
    }, 100)
    try {
      await host.execute({ type: 'send', text: `@${agent} Create a file named anna.txt containing exactly OK (no newline needed). Then reply with one short sentence.` })
      const snapshot = host.snapshot()
      expect((await readFile(join(workspace, 'anna.txt'), 'utf8')).trim()).toBe('OK')
      expect(approvals).toBeGreaterThan(0)
      expect(snapshot.result?.changes.map(change => change.path)).toContain('anna.txt')
      expect(snapshot.messages!.at(-1)).toMatchObject({ delegation: { agent, status: 'completed' } })
      process.stdout.write(`${agent} approvals ${approvals} reply: ${snapshot.messages!.at(-1)!.text.slice(0, 120)}\n`)
    }
    finally {
      clearInterval(timer)
      await host.close()
      vi.restoreAllMocks()
    }
  }, 240000)
})

describe.skipIf(!wanted.includes('claude'))('real Claude Code as Anna\'s brain', () => {
  it('answers a plain message with Anna\'s persona and keeps the conversation', async () => {
    const { mkdir, mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join, resolve } = await import('node:path')
    const { Host } = await import('../packages/anna-host/host')
    const data = await mkdtemp(join(tmpdir(), 'anna-real-brain-'))
    const workspace = join(data, 'project')
    await mkdir(workspace)
    await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'claude-code', characterId: 'haru', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'plan', rules: { allow: [], ask: [], deny: [] } } } }))
    const host = new Host(resolve('.'), data, { read: async () => '', write: async () => {} }, () => {}, { sandbox: { available: false, reason: 'test' } })
    await host.initialize()
    await host.execute({ type: 'send', text: '你叫什么名字？只回答名字。' })
    const reply = host.snapshot().messages!.at(-1)!.text
    process.stdout.write(`brain reply: ${reply}\n`)
    expect(reply).toMatch(/Anna/i)
    expect(host.snapshot().kernel.id).toBe('claude-code')
    await host.close()
  }, 180000)
})

const brains = wanted.filter(agent => agent === 'claude' || agent === 'codex')
/**
 * Optionally run the brain on a provider preset instead of the CLI's own login, e.g.
 * ANNA_REAL_PROVIDER=DeepSeek ANNA_REAL_PROVIDER_KEY=sk-… ANNA_REAL_AGENTS=codex pnpm vitest run tests/agents-real.test.ts -t "own tools"
 */
const realProvider = process.env.ANNA_REAL_PROVIDER
describe.skipIf(!brains.length)('real Claude Code / Codex as the brain, with Anna\'s own tools', () => {
  it.each(brains)('%s: writes to the shared diary through the anna MCP server, without an approval card', async (agent) => {
    const { mkdir, mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join, resolve } = await import('node:path')
    const { Host } = await import('../packages/anna-host/host')
    const data = await mkdtemp(join(tmpdir(), `anna-real-tools-${agent}-`))
    const workspace = join(data, 'project')
    await mkdir(workspace)
    await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: agent === 'claude' ? 'claude-code' : 'codex', characterId: 'mark', statusEnabled: true, memoryEnabled: true, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'ask', rules: { allow: [], ask: [], deny: [] } } } }))
    const host = new Host(resolve('.'), data, { read: async () => '', write: async () => {} }, () => {}, { sandbox: { available: false, reason: 'test' } })
    await host.initialize()
    if (realProvider)
      await host.execute({ type: 'agent-provider', agent, provider: realProvider, key: process.env.ANNA_REAL_PROVIDER_KEY })
    try {
      await host.execute({ type: 'send', text: '请记住：我最喜欢的茶是龙井。用共同记忆工具记下来，然后用一句话告诉我。' })
      const snapshot = host.snapshot()
      process.stdout.write(`${agent} brain (${realProvider ?? 'own login'}) memories: ${JSON.stringify(snapshot.memories.map(item => item.text))} reply: ${snapshot.messages!.at(-1)?.text.slice(0, 120)}\n`)
      expect(snapshot.approvals).toEqual([])
      expect(snapshot.memories.some(item => item.text.includes('龙井'))).toBe(true)
    }
    finally {
      await host.close()
    }
  }, 240000)
})
