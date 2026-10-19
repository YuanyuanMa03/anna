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

/**
 * Real Codex, with a scripted Chat Completions provider behind Anna's routing: Codex's Responses requests become
 * Chat requests and the Chat stream becomes Responses events Codex accepts, tool calls included. Needs no login.
 */
describe.skipIf(!wanted.includes('codex'))('real Codex through Anna\'s local routing', () => {
  it('a Chat provider edits a file with Codex\'s apply_patch and answers', async () => {
    const { createServer } = await import('node:http')
    const { mkdir, mkdtemp, readFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { buildLaunch } = await import('../packages/agents/launch')
    const { openRoute } = await import('../packages/agents/route')
    const { runAgent } = await import('../packages/agents/runner')
    const env = nodeEnvironment()
    const codex = (await detectAgents(env)).find(agent => agent.id === 'codex')!
    const data = await mkdtemp(join(tmpdir(), 'anna-real-route-'))
    const workspace = join(data, 'project')
    await mkdir(workspace)
    await mkdir(join(data, 'codex-home'))
    const requests: { path: string, authorization?: string, body: any }[] = []
    const chunk = (delta: object, finish?: string) => `data: ${JSON.stringify({ id: `chatcmpl_${requests.length}`, model: 'fake-chat-1', choices: [{ index: 0, delta, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`
    const patch = '*** Begin Patch\n*** Add File: anna.txt\n+OK\n*** End Patch\n'
    const upstream = createServer((request, response) => {
      let text = ''
      request.on('data', (part) => { text += part })
      request.on('end', () => {
        const body = JSON.parse(text)
        requests.push({ path: request.url!, authorization: request.headers.authorization, body })
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        const done = body.messages.some((message: any) => message.role === 'tool')
        response.end(done
          ? `${chunk({ reasoning_content: 'The file is there.' })}${chunk({ content: 'Done: anna.txt says OK.' })}${chunk({}, 'stop')}data: ${JSON.stringify({ id: 'u', choices: [], usage: { prompt_tokens: 50, completion_tokens: 8, total_tokens: 58 } })}\n\ndata: [DONE]\n\n`
          : `${chunk({ reasoning_content: 'Create the file with a patch.' })}${chunk({ tool_calls: [{ index: 0, id: 'call_patch', type: 'function', function: { name: 'apply_patch', arguments: '' } }] })}${chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ input: patch }) } }] })}${chunk({}, 'tool_calls')}data: [DONE]\n\n`)
      })
    })
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
    const preset = { name: 'Fake Chat', official: false, category: 'custom', baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`, model: 'fake-chat-1', apiFormat: 'openai_chat' as const, chatReasoning: { supportsThinking: true, thinkingParam: 'thinking' } }
    const provider = { preset, key: 'sk-fake-real' }
    const route = await openRoute('codex', provider)
    try {
      const launch = buildLaunch('codex', { cwd: workspace, prompt: 'Create a file named anna.txt containing exactly OK, then say so.', mode: 'edit', denyPaths: [], provider, route })
      // A fresh CODEX_HOME: none of this machine's Codex config or login takes part.
      launch.env.CODEX_HOME = join(data, 'codex-home')
      const result = await runAgent({ agent: 'codex', command: codex.path!, launch, cwd: workspace, gate: async () => ({ allow: true }), emit: () => {} })
      process.stdout.write(`codex via routing: ${result.status} ${result.error ?? ''} reply: ${result.text.slice(0, 120)} requests: ${requests.length}\n`)
      expect(result.status).toBe('completed')
      expect(result.text).toContain('Done')
      expect((await readFile(join(workspace, 'anna.txt'), 'utf8')).trim()).toBe('OK')
      expect(requests.every(item => item.path === '/v1/chat/completions' && item.authorization === 'Bearer sk-fake-real')).toBe(true)
      const first = requests.find(item => !item.body.messages.some((message: any) => message.role === 'tool'))!.body
      expect(first).toMatchObject({ model: 'fake-chat-1', stream: true, stream_options: { include_usage: true }, thinking: { type: 'enabled' } })
      expect(first.tools.map((tool: any) => tool.function.name)).toContain('apply_patch')
      const second = requests.find(item => item.body.messages.some((message: any) => message.role === 'tool'))!.body
      expect(second.messages).toContainEqual(expect.objectContaining({ role: 'assistant', reasoning_content: 'Create the file with a patch.', tool_calls: [expect.objectContaining({ id: 'call_patch' })] }))
      expect(second.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'call_patch' }))
    }
    finally {
      route?.close()
      upstream.closeAllConnections()
      upstream.close()
    }
  }, 180000)

  it('as Anna\'s brain on a Chat provider, Codex calls Anna\'s own memory tool (an MCP namespace tool) and answers', async () => {
    const { createServer } = await import('node:http')
    const { mkdir, mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join, resolve } = await import('node:path')
    const { Host } = await import('../packages/anna-host/host')
    const data = await mkdtemp(join(tmpdir(), 'anna-real-route-brain-'))
    const workspace = join(data, 'project')
    await mkdir(workspace)
    await mkdir(join(data, 'codex-home'))
    const names: string[][] = []
    const upstream = createServer((request, response) => {
      let text = ''
      request.on('data', (part) => { text += part })
      request.on('end', () => {
        const body = JSON.parse(text)
        const tools: string[] = (body.tools ?? []).map((tool: any) => tool.function.name)
        names.push(tools)
        const memory = tools.find(name => name.includes('anna_memory'))
        const answered = body.messages.some((message: any) => message.role === 'tool')
        const chunk = (delta: object, finish?: string) => `data: ${JSON.stringify({ id: `chatcmpl_${names.length}`, choices: [{ index: 0, delta, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(answered || !memory
          ? `${chunk({ content: answered ? '记好了，你最喜欢龙井。' : 'no memory tool' })}${chunk({}, 'stop')}data: [DONE]\n\n`
          : `${chunk({ tool_calls: [{ index: 0, id: 'call_memory', type: 'function', function: { name: memory, arguments: JSON.stringify({ action: 'remember', text: '最喜欢的茶是龙井' }) } }] })}${chunk({}, 'tool_calls')}data: [DONE]\n\n`)
      })
    })
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
    const previousHome = process.env.CODEX_HOME
    process.env.CODEX_HOME = join(data, 'codex-home')
    await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'codex', characterId: 'mark', statusEnabled: true, memoryEnabled: true, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'ask', rules: { allow: [], ask: [], deny: [] } } } }))
    const secrets: Record<string, string> = {}
    const host = new Host(resolve('.'), data, { read: async () => '', write: async () => {} }, () => {}, { sandbox: { available: false, reason: 'test' }, secrets: { read: async () => secrets.providers ?? '', write: async (value) => { secrets.providers = value } } })
    try {
      await host.initialize()
      await host.execute({ type: 'provider-save', app: 'codex', name: 'Fake Chat', baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`, model: 'fake-chat-1', key: 'sk-fake-real', apiFormat: 'openai_chat' })
      await host.execute({ type: 'agent-provider', agent: 'codex', provider: 'Fake Chat' })
      await host.execute({ type: 'send', text: '请记住：我最喜欢的茶是龙井。' })
      const snapshot = host.snapshot()
      process.stdout.write(`codex brain via routing: tools ${JSON.stringify(names[0]?.filter(name => name.includes('anna')))} memories ${JSON.stringify(snapshot.memories.map(item => item.text))} reply: ${snapshot.messages!.at(-1)?.text}\n`)
      // Listed up front, not behind tool_search: the brain sees Anna's tools every turn.
      expect(names[0]).toContain('mcp__anna__anna_memory')
      expect(snapshot.approvals).toEqual([])
      expect(snapshot.memories.some(item => item.text.includes('龙井'))).toBe(true)
      expect(snapshot.messages!.at(-1)?.text).toContain('记好了')
    }
    finally {
      await host.close()
      upstream.closeAllConnections()
      upstream.close()
      if (previousHome === undefined)
        delete process.env.CODEX_HOME
      else
        process.env.CODEX_HOME = previousHome
    }
  }, 180000)
})

/**
 * Real Codex through Anna's routing to a real Chat Completions provider (DeepSeek by default). The key only ever comes
 * from the environment; enter it without echo, e.g.
 * read -rs ANNA_REAL_CHAT_KEY && ANNA_REAL_CHAT_KEY=$ANNA_REAL_CHAT_KEY pnpm vitest run tests/agents-real.test.ts -t "real Chat provider"
 * Optional: ANNA_REAL_CHAT_URL, ANNA_REAL_CHAT_MODEL.
 */
const chatKey = process.env.ANNA_REAL_CHAT_KEY
const chatUrl = process.env.ANNA_REAL_CHAT_URL ?? 'https://api.deepseek.com'
const chatModel = process.env.ANNA_REAL_CHAT_MODEL ?? 'deepseek-flash'
describe.skipIf(!chatKey)('real Codex through Anna\'s routing to a real Chat provider', () => {
  it('delegated: creates a file and says so', async () => {
    const { mkdir, mkdtemp, readFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { buildLaunch } = await import('../packages/agents/launch')
    const { routing } = await import('../packages/routing/server')
    const { openRoute } = await import('../packages/agents/route')
    const { runAgent } = await import('../packages/agents/runner')
    const codex = (await detectAgents(nodeEnvironment())).find(agent => agent.id === 'codex')!
    const data = await mkdtemp(join(tmpdir(), 'anna-real-chat-'))
    const workspace = join(data, 'project')
    await mkdir(workspace)
    await mkdir(join(data, 'codex-home'))
    const preset = { name: 'Real Chat', official: false, category: 'custom', baseUrl: chatUrl, model: chatModel, apiFormat: 'openai_chat' as const, chatReasoning: { supportsThinking: true, supportsEffort: true, thinkingParam: 'thinking', effortParam: 'reasoning_effort', effortValueMode: 'deepseek' } }
    const provider = { preset, key: chatKey }
    const route = await openRoute('codex', provider)
    try {
      const launch = buildLaunch('codex', { cwd: workspace, prompt: 'Create a file named anna.txt containing exactly OK. Then reply with one short sentence.', mode: 'edit', denyPaths: [], provider, route })
      launch.env.CODEX_HOME = join(data, 'codex-home')
      const result = await runAgent({ agent: 'codex', command: codex.path!, launch, cwd: workspace, gate: async () => ({ allow: true }), emit: () => {} })
      const records = (await routing()).records().filter(item => item.provider === 'Real Chat')
      process.stdout.write(`real chat (${chatModel}) delegated: ${result.status} ${result.error ?? ''} reply: ${result.text.slice(0, 160)}\nrequests: ${JSON.stringify(records.map(({ status, latency, usage, outcome }) => ({ status, latency, usage, outcome })))}\n`)
      expect(result.status).toBe('completed')
      expect((await readFile(join(workspace, 'anna.txt'), 'utf8')).trim()).toBe('OK')
      expect(records.every(item => item.status === 200)).toBe(true)
    }
    finally {
      route?.close()
    }
  }, 300000)

  it('as Anna\'s brain: remembers through anna_memory and answers', async () => {
    const { mkdir, mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join, resolve } = await import('node:path')
    const { Host } = await import('../packages/anna-host/host')
    const data = await mkdtemp(join(tmpdir(), 'anna-real-chat-brain-'))
    const workspace = join(data, 'project')
    await mkdir(workspace)
    await mkdir(join(data, 'codex-home'))
    const previousHome = process.env.CODEX_HOME
    process.env.CODEX_HOME = join(data, 'codex-home')
    await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'codex', characterId: 'mark', statusEnabled: true, memoryEnabled: true, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'ask', rules: { allow: [], ask: [], deny: [] } } } }))
    const secrets: Record<string, string> = {}
    const host = new Host(resolve('.'), data, { read: async () => '', write: async () => {} }, () => {}, { sandbox: { available: false, reason: 'test' }, secrets: { read: async () => secrets.providers ?? '', write: async (value) => { secrets.providers = value } } })
    try {
      await host.initialize()
      await host.execute({ type: 'provider-save', app: 'codex', name: 'Real Chat', baseUrl: chatUrl, model: chatModel, key: chatKey, apiFormat: 'openai_chat' })
      await host.execute({ type: 'agent-provider', agent: 'codex', provider: 'Real Chat' })
      await host.execute({ type: 'send', text: '请记住：我最喜欢的茶是龙井。用共同记忆工具记下来，然后用一句话告诉我。' })
      const snapshot = host.snapshot()
      process.stdout.write(`real chat (${chatModel}) brain: memories ${JSON.stringify(snapshot.memories.map(item => item.text))} reply: ${snapshot.messages!.at(-1)?.text.slice(0, 160)}\n`)
      expect(snapshot.approvals).toEqual([])
      expect(snapshot.memories.some(item => item.text.includes('龙井'))).toBe(true)
    }
    finally {
      await host.close()
      if (previousHome === undefined)
        delete process.env.CODEX_HOME
      else
        process.env.CODEX_HOME = previousHome
    }
  }, 300000)
})

describe.skipIf(!chatKey)('real Claude Code through Anna\'s routing to a real Chat provider', () => {
  it('delegated: creates a file and says so', async () => {
    const { mkdir, mkdtemp, readFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { buildLaunch } = await import('../packages/agents/launch')
    const { routing } = await import('../packages/routing/server')
    const { openRoute } = await import('../packages/agents/route')
    const { runAgent } = await import('../packages/agents/runner')
    const claude = (await detectAgents(nodeEnvironment())).find(agent => agent.id === 'claude')!
    const data = await mkdtemp(join(tmpdir(), 'anna-real-chat-claude-'))
    const workspace = join(data, 'project')
    await mkdir(workspace)
    const preset = { name: 'Real Chat (Claude Code)', official: false, category: 'custom', apiFormat: 'openai_chat' as const, env: { ANTHROPIC_BASE_URL: chatUrl, ANTHROPIC_MODEL: chatModel, ANTHROPIC_DEFAULT_HAIKU_MODEL: chatModel } }
    const provider = { preset, key: chatKey }
    const route = await openRoute('claude', provider)
    try {
      const launch = buildLaunch('claude', { cwd: workspace, prompt: 'Create a file named anna.txt containing exactly OK. Then reply with one short sentence.', mode: 'edit', denyPaths: [], provider, route })
      launch.env.CLAUDE_CONFIG_DIR = join(data, 'claude-config')
      const result = await runAgent({ agent: 'claude', command: claude.path!, launch, cwd: workspace, gate: async () => ({ allow: true }), emit: () => {} })
      const records = (await routing()).records().filter(item => item.provider === preset.name)
      process.stdout.write(`real chat (${chatModel}) claude delegated: ${result.status} ${result.error ?? ''} reply: ${result.text.slice(0, 160)}\nrequests: ${JSON.stringify(records.map(({ model, status, latency, usage, outcome }) => ({ model, status, latency, usage, outcome })))}\n`)
      expect(result.status).toBe('completed')
      expect((await readFile(join(workspace, 'anna.txt'), 'utf8')).trim()).toBe('OK')
      expect(records.every(item => item.status === 200)).toBe(true)
    }
    finally {
      route?.close()
    }
  }, 300000)

  it('as Anna\'s brain: remembers through anna_memory and answers', async () => {
    const { mkdir, mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join, resolve } = await import('node:path')
    const { Host } = await import('../packages/anna-host/host')
    const data = await mkdtemp(join(tmpdir(), 'anna-real-chat-claude-brain-'))
    const workspace = join(data, 'project')
    await mkdir(workspace)
    const previousConfig = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = join(data, 'claude-config')
    await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'claude-code', characterId: 'mark', statusEnabled: true, memoryEnabled: true, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'ask', rules: { allow: [], ask: [], deny: [] } } } }))
    const secrets: Record<string, string> = {}
    const host = new Host(resolve('.'), data, { read: async () => '', write: async () => {} }, () => {}, { sandbox: { available: false, reason: 'test' }, secrets: { read: async () => secrets.providers ?? '', write: async (value) => { secrets.providers = value } } })
    try {
      await host.initialize()
      await host.execute({ type: 'provider-save', app: 'claude', name: 'Real Chat', baseUrl: chatUrl, model: chatModel, key: chatKey, apiFormat: 'openai_chat' })
      await host.execute({ type: 'agent-provider', agent: 'claude', provider: 'Real Chat' })
      await host.execute({ type: 'send', text: '请记住：我最喜欢的茶是龙井。用共同记忆工具记下来，然后用一句话告诉我。' })
      const snapshot = host.snapshot()
      process.stdout.write(`real chat (${chatModel}) claude brain: memories ${JSON.stringify(snapshot.memories.map(item => item.text))} reply: ${snapshot.messages!.at(-1)?.text.slice(0, 160)}\n`)
      expect(snapshot.approvals).toEqual([])
      expect(snapshot.memories.some(item => item.text.includes('龙井'))).toBe(true)
    }
    finally {
      await host.close()
      if (previousConfig === undefined)
        delete process.env.CLAUDE_CONFIG_DIR
      else
        process.env.CLAUDE_CONFIG_DIR = previousConfig
    }
  }, 300000)
})

/**
 * Real Claude Code with a scripted Chat Completions provider behind Anna's routing: its Anthropic requests become
 * Chat requests and the Chat stream becomes Anthropic events it accepts, tool calls included. Needs no login; a fresh
 * CLAUDE_CONFIG_DIR keeps this machine's settings out.
 */
describe.skipIf(!wanted.includes('claude'))('real Claude Code through Anna\'s local routing', () => {
  async function fakeChat(pick: (tools: string[]) => { name: string, input: object } | undefined, answer: string) {
    const { createServer } = await import('node:http')
    const requests: { path: string, authorization?: string, body: any }[] = []
    const server = createServer((request, response) => {
      let text = ''
      request.on('data', (part) => { text += part })
      request.on('end', () => {
        const body = JSON.parse(text)
        requests.push({ path: request.url!, authorization: request.headers.authorization, body })
        const tools: string[] = (body.tools ?? []).map((tool: any) => tool.function.name)
        const answered = body.messages.some((message: any) => message.role === 'tool')
        const call = answered ? undefined : pick(tools)
        const chunk = (delta: object, finish?: string) => `data: ${JSON.stringify({ id: `chatcmpl_${requests.length}`, model: body.model, choices: [{ index: 0, delta, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`
        const usage = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 6, prompt_tokens_details: { cached_tokens: 32 } } })}\n\n`
        const reply = call
          ? `${chunk({ reasoning_content: 'Use the tool.' })}${chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: call.name, arguments: '' } }] })}${chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(call.input) } }] })}${chunk({}, 'tool_calls')}${usage}data: [DONE]\n\n`
          : `${chunk({ content: answered ? answer : 'ok' })}${chunk({}, 'stop')}${usage}data: [DONE]\n\n`
        if (body.stream) {
          response.writeHead(200, { 'content-type': 'text/event-stream' })
          return response.end(reply)
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ id: 'chatcmpl_plain', model: body.model, choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 1 } }))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    return { requests, url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => { server.closeAllConnections(); server.close() } }
  }

  it('a Chat provider writes a file with Claude Code\'s Write tool and answers', async () => {
    const { mkdir, mkdtemp, readFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { buildLaunch } = await import('../packages/agents/launch')
    const { openRoute } = await import('../packages/agents/route')
    const { runAgent } = await import('../packages/agents/runner')
    const claude = (await detectAgents(nodeEnvironment())).find(agent => agent.id === 'claude')!
    const data = await mkdtemp(join(tmpdir(), 'anna-real-claude-route-'))
    const workspace = join(data, 'project')
    await mkdir(workspace)
    const upstream = await fakeChat(tools => tools.includes('Write') ? { name: 'Write', input: { file_path: join(workspace, 'anna.txt'), content: 'OK' } } : undefined, 'Done: anna.txt says OK.')
    const preset = { name: 'Fake Chat', official: false, category: 'custom', apiFormat: 'openai_chat' as const, env: { ANTHROPIC_BASE_URL: upstream.url, ANTHROPIC_MODEL: 'fake-chat-pro', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'fake-chat-flash' } }
    const provider = { preset, key: 'sk-fake-real' }
    const route = await openRoute('claude', provider)
    try {
      const launch = buildLaunch('claude', { cwd: workspace, prompt: 'Create a file named anna.txt containing exactly OK, then say so.', mode: 'edit', denyPaths: [], provider, route })
      launch.env.CLAUDE_CONFIG_DIR = join(data, 'claude-config')
      const result = await runAgent({ agent: 'claude', command: claude.path!, launch, cwd: workspace, gate: async () => ({ allow: true }), emit: () => {} })
      process.stdout.write(`claude via routing: ${result.status} ${result.error ?? ''} reply: ${result.text.slice(0, 120)} requests: ${upstream.requests.length} models: ${JSON.stringify([...new Set(upstream.requests.map(item => item.body.model))])}\n`)
      expect(result.status).toBe('completed')
      expect(result.text).toContain('Done')
      expect((await readFile(join(workspace, 'anna.txt'), 'utf8')).trim()).toBe('OK')
      expect(upstream.requests.every(item => item.path === '/v1/chat/completions' && item.authorization === 'Bearer sk-fake-real')).toBe(true)
      expect(upstream.requests.every(item => item.body.model.startsWith('fake-chat-'))).toBe(true)
      const second = upstream.requests.find(item => item.body.messages.some((message: any) => message.role === 'tool'))!.body
      expect(second.messages).toContainEqual(expect.objectContaining({ role: 'assistant', tool_calls: [expect.objectContaining({ id: 'call_1', function: expect.objectContaining({ name: 'Write' }) })] }))
    }
    finally {
      route?.close()
      upstream.close()
    }
  }, 180000)

  it('as Anna\'s brain on a Chat provider, Claude Code calls Anna\'s own memory tool and answers', async () => {
    const { mkdir, mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join, resolve } = await import('node:path')
    const { Host } = await import('../packages/anna-host/host')
    const data = await mkdtemp(join(tmpdir(), 'anna-real-claude-route-brain-'))
    const workspace = join(data, 'project')
    await mkdir(workspace)
    const upstream = await fakeChat(tools => tools.find(name => name.includes('anna_memory')) ? { name: tools.find(name => name.includes('anna_memory'))!, input: { action: 'remember', text: '最喜欢的茶是龙井' } } : undefined, '记好了，你最喜欢龙井。')
    const previousConfig = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = join(data, 'claude-config')
    await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'claude-code', characterId: 'mark', statusEnabled: true, memoryEnabled: true, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'ask', rules: { allow: [], ask: [], deny: [] } } } }))
    const secrets: Record<string, string> = {}
    const host = new Host(resolve('.'), data, { read: async () => '', write: async () => {} }, () => {}, { sandbox: { available: false, reason: 'test' }, secrets: { read: async () => secrets.providers ?? '', write: async (value) => { secrets.providers = value } } })
    try {
      await host.initialize()
      await host.execute({ type: 'provider-save', app: 'claude', name: 'Fake Chat', baseUrl: upstream.url, model: 'fake-chat-pro', key: 'sk-fake-real', apiFormat: 'openai_chat' })
      await host.execute({ type: 'agent-provider', agent: 'claude', provider: 'Fake Chat' })
      await host.execute({ type: 'send', text: '请记住：我最喜欢的茶是龙井。' })
      const snapshot = host.snapshot()
      process.stdout.write(`claude brain via routing: memories ${JSON.stringify(snapshot.memories.map(item => item.text))} reply: ${snapshot.messages!.at(-1)?.text}\n`)
      expect(snapshot.approvals).toEqual([])
      expect(snapshot.memories.some(item => item.text.includes('龙井'))).toBe(true)
      expect(snapshot.messages!.at(-1)?.text).toContain('记好了')
    }
    finally {
      await host.close()
      upstream.close()
      if (previousConfig === undefined)
        delete process.env.CLAUDE_CONFIG_DIR
      else
        process.env.CLAUDE_CONFIG_DIR = previousConfig
    }
  }, 180000)
})

/**
 * Real agents failing over: the provider in use answers 503, and the backup is a provider in the agent's own format —
 * a second Anna route in front of a scripted Chat upstream — so the run also goes through native passthrough.
 */
describe.skipIf(!wanted.includes('codex') && !wanted.includes('claude'))('real agents failing over to a backup', () => {
  async function upstreams(pick: (tools: string[]) => { name: string, input: object } | undefined, answer: string) {
    const { createServer } = await import('node:http')
    const hits: string[] = []
    const server = createServer((request, response) => {
      let text = ''
      request.on('data', (part) => { text += part })
      request.on('end', () => {
        hits.push(request.url!)
        if (request.url!.startsWith('/down/')) {
          response.writeHead(503, { 'content-type': 'application/json' })
          return response.end('{"error":{"message":"overloaded"}}')
        }
        const body = JSON.parse(text)
        const tools: string[] = (body.tools ?? []).map((tool: any) => tool.function.name)
        const answered = body.messages.some((message: any) => message.role === 'tool')
        const call = answered ? undefined : pick(tools)
        const chunk = (delta: object, finish?: string) => `data: ${JSON.stringify({ id: `c${hits.length}`, model: body.model, choices: [{ index: 0, delta, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`
        if (!body.stream) {
          response.writeHead(200, { 'content-type': 'application/json' })
          return response.end(JSON.stringify({ id: 'plain', model: body.model, choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }))
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(call
          ? `${chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: call.name, arguments: JSON.stringify(call.input) } }] })}${chunk({}, 'tool_calls')}data: [DONE]\n\n`
          : `${chunk({ content: answered ? answer : 'ok' })}${chunk({}, 'stop')}data: [DONE]\n\n`)
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    return { hits, url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => { server.closeAllConnections(); server.close() } }
  }

  it.skipIf(!wanted.includes('codex'))('codex: the 503 goes unseen, the backup edits the file, the stage line says what happened', async () => {
    const { mkdir, mkdtemp, readFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { buildLaunch } = await import('../packages/agents/launch')
    const { failoverLine, openRoute } = await import('../packages/agents/route')
    const { runAgent } = await import('../packages/agents/runner')
    const { routing } = await import('../packages/routing/server')
    const codex = (await detectAgents(nodeEnvironment())).find(agent => agent.id === 'codex')!
    const data = await mkdtemp(join(tmpdir(), 'anna-real-failover-codex-'))
    const workspace = join(data, 'project')
    await mkdir(workspace)
    await mkdir(join(data, 'codex-home'))
    const fake = await upstreams(tools => tools.includes('apply_patch') ? { name: 'apply_patch', input: { input: '*** Begin Patch\n*** Add File: anna.txt\n+OK\n*** End Patch\n' } } : undefined, 'Done: anna.txt says OK.')
    const inner = (await routing()).open({ baseUrl: `${fake.url}/up/v1`, key: 'k' })
    const lines: string[] = []
    const down = { name: 'Down', official: false, category: 'custom', baseUrl: `${fake.url}/down/v1`, model: 'fake-chat-1', apiFormat: 'openai_chat' as const }
    const native = { name: 'Native', official: false, category: 'custom', baseUrl: inner.baseUrl, model: 'fake-chat-1' }
    const route = await openRoute('codex', { preset: down, key: 'sk-down' }, { backups: [{ preset: native, key: inner.token }], onFailover: event => lines.push(failoverLine(event)) })
    try {
      const launch = buildLaunch('codex', { cwd: workspace, prompt: 'Create a file named anna.txt containing exactly OK, then say so.', mode: 'edit', denyPaths: [], provider: { preset: down, key: 'sk-down' }, route })
      launch.env.CODEX_HOME = join(data, 'codex-home')
      const result = await runAgent({ agent: 'codex', command: codex.path!, launch, cwd: workspace, gate: async () => ({ allow: true }), emit: () => {} })
      process.stdout.write(`codex failover: ${result.status} ${result.error ?? ''} reply: ${result.text.slice(0, 80)} lines: ${JSON.stringify([...new Set(lines)])}\n`)
      expect(result.status).toBe('completed')
      expect((await readFile(join(workspace, 'anna.txt'), 'utf8')).trim()).toBe('OK')
      expect(lines).toContain('Down 返回了 503，换成 Native')
      expect(fake.hits.some(hit => hit.startsWith('/up/'))).toBe(true)
    }
    finally {
      route?.close()
      inner.close()
      fake.close()
    }
  }, 180000)

  it.skipIf(!wanted.includes('claude'))('claude Code: the 503 goes unseen, the backup writes the file, the stage line says what happened', async () => {
    const { mkdir, mkdtemp, readFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { buildLaunch } = await import('../packages/agents/launch')
    const { failoverLine, openRoute } = await import('../packages/agents/route')
    const { runAgent } = await import('../packages/agents/runner')
    const { routing } = await import('../packages/routing/server')
    const claude = (await detectAgents(nodeEnvironment())).find(agent => agent.id === 'claude')!
    const data = await mkdtemp(join(tmpdir(), 'anna-real-failover-claude-'))
    const workspace = join(data, 'project')
    await mkdir(workspace)
    const fake = await upstreams(tools => tools.includes('Write') ? { name: 'Write', input: { file_path: join(workspace, 'anna.txt'), content: 'OK' } } : undefined, 'Done: anna.txt says OK.')
    const inner = (await routing()).open({ client: 'claude', baseUrl: `${fake.url}/up`, key: 'k' })
    const lines: string[] = []
    const down = { name: 'Down', official: false, category: 'custom', apiFormat: 'openai_chat' as const, env: { ANTHROPIC_BASE_URL: `${fake.url}/down`, ANTHROPIC_MODEL: 'fake-chat-pro' } }
    const native = { name: 'Native', official: false, category: 'custom', keyField: 'ANTHROPIC_AUTH_TOKEN', env: { ANTHROPIC_BASE_URL: inner.baseUrl, ANTHROPIC_MODEL: 'fake-native-pro' } }
    const route = await openRoute('claude', { preset: down, key: 'sk-down' }, { backups: [{ preset: native, key: inner.token }], onFailover: event => lines.push(failoverLine(event)) })
    try {
      const launch = buildLaunch('claude', { cwd: workspace, prompt: 'Create a file named anna.txt containing exactly OK, then say so.', mode: 'edit', denyPaths: [], provider: { preset: down, key: 'sk-down' }, route })
      launch.env.CLAUDE_CONFIG_DIR = join(data, 'claude-config')
      const result = await runAgent({ agent: 'claude', command: claude.path!, launch, cwd: workspace, gate: async () => ({ allow: true }), emit: () => {} })
      process.stdout.write(`claude failover: ${result.status} ${result.error ?? ''} reply: ${result.text.slice(0, 80)} lines: ${JSON.stringify([...new Set(lines)])}\n`)
      expect(result.status).toBe('completed')
      expect((await readFile(join(workspace, 'anna.txt'), 'utf8')).trim()).toBe('OK')
      expect(lines).toContain('Down 返回了 503，换成 Native')
    }
    finally {
      route?.close()
      inner.close()
      fake.close()
    }
  }, 180000)
})

/**
 * Global routing with the real CLIs, run the way a user runs them in a terminal: their own config folder, taken over by
 * Anna, and nothing from Anna in their environment. Their requests reach a scripted Chat upstream through the route.
 */
describe.skipIf(!wanted.includes('codex') && !wanted.includes('claude'))('real CLIs in a terminal, through Anna\'s global routing', () => {
  async function prepare() {
    const { createServer } = await import('node:http')
    const { mkdir, mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join, resolve } = await import('node:path')
    const { Host } = await import('../packages/anna-host/host')
    const hits: { path: string, authorization?: string, model?: string }[] = []
    const upstream = createServer((request, response) => {
      let text = ''
      request.on('data', (part) => { text += part })
      request.on('end', () => {
        const body = JSON.parse(text)
        hits.push({ path: request.url!, authorization: request.headers.authorization, model: body.model })
        const chunk = (delta: object, finish?: string) => `data: ${JSON.stringify({ id: 'c', model: body.model, choices: [{ index: 0, delta, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`
        if (!body.stream) {
          response.writeHead(200, { 'content-type': 'application/json' })
          return response.end(JSON.stringify({ id: 'plain', model: body.model, choices: [{ message: { role: 'assistant', content: 'routed through Anna' }, finish_reason: 'stop' }] }))
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(`${chunk({ content: 'routed through Anna' })}${chunk({}, 'stop')}data: [DONE]\n\n`)
      })
    })
    await new Promise<void>(done => upstream.listen(0, '127.0.0.1', done))
    const url = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
    const data = await mkdtemp(join(tmpdir(), 'anna-real-global-'))
    const workspace = join(data, 'project')
    const configs = { claude: join(data, 'home/.claude'), codex: join(data, 'home/.codex'), gemini: join(data, 'home/.gemini') }
    for (const dir of [workspace, configs.claude, configs.codex]) await mkdir(dir, { recursive: true })
    await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'haru', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'ask', rules: { allow: [], ask: [], deny: [] } } } }))
    const secrets: Record<string, string> = {}
    const host = new Host(resolve('.'), data, { read: async () => '', write: async () => {} }, () => {}, { sandbox: { available: false, reason: 'test' }, secrets: { read: async () => secrets.providers ?? '', write: async (value) => { secrets.providers = value } }, agents: { configDirs: configs, routingPort: 0 } })
    await host.initialize()
    return { host, hits, url, workspace, configs, close: () => { upstream.closeAllConnections(); upstream.close() } }
  }
  /** The CLI's environment as a terminal has it: nothing of Anna's, no ANTHROPIC_* or OpenAI keys. */
  async function terminal(command: string, args: string[], cwd: string, extra: Record<string, string>) {
    const { execFile } = await import('node:child_process')
    const env = Object.fromEntries(Object.entries(nodeEnvironment().env).filter(([key]) => !/^(?:ANTHROPIC_|OPENAI_|CLAUDE_CODE_|ANNA_)/.test(key)))
    return new Promise<string>((done) => {
      const child = execFile(command, args, { cwd, env: { ...env, ...extra }, timeout: 120_000 }, (error, stdout, stderr) => done(`${stdout}\n${stderr}${error ? `\n${error.message}` : ''}`))
      // A terminal command with nothing piped in: stdin closed.
      child.stdin?.end()
    })
  }

  it.skipIf(!wanted.includes('codex'))('codex exec reads its taken-over config.toml and answers through the route', async () => {
    const { join } = await import('node:path')
    const codex = (await detectAgents(nodeEnvironment())).find(agent => agent.id === 'codex')!
    const setup = await prepare()
    try {
      await setup.host.execute({ type: 'provider-save', app: 'codex', name: 'Fake Chat', baseUrl: `${setup.url}/v1`, model: 'fake-chat-1', key: 'sk-fake-real', apiFormat: 'openai_chat' })
      await setup.host.execute({ type: 'agent-provider', agent: 'codex', provider: 'Fake Chat' })
      await setup.host.execute({ type: 'provider-routing', app: 'codex', on: true })
      const output = await terminal(codex.path!, ['exec', '--skip-git-repo-check', 'Say hello.'], setup.workspace, { CODEX_HOME: setup.configs.codex })
      process.stdout.write(`terminal codex: ${output.trim().split('\n').slice(-3).join(' | ')} hits: ${JSON.stringify(setup.hits.map(hit => [hit.path, hit.model]))}\n`)
      expect(output).toContain('routed through Anna')
      expect(setup.hits.every(hit => hit.path === '/v1/chat/completions' && hit.authorization === 'Bearer sk-fake-real')).toBe(true)
      expect(setup.hits.length).toBeGreaterThan(0)
      await setup.host.close()
      const { readFile } = await import('node:fs/promises')
      expect(await readFile(join(setup.configs.codex, 'config.toml'), 'utf8').catch(() => 'gone')).toBe('gone')
    }
    finally {
      setup.close()
    }
  }, 180000)

  it.skipIf(!wanted.includes('claude'))('claude -p reads its taken-over settings.json and answers through the route', async () => {
    const claude = (await detectAgents(nodeEnvironment())).find(agent => agent.id === 'claude')!
    const setup = await prepare()
    try {
      await setup.host.execute({ type: 'provider-save', app: 'claude', name: 'Fake Chat', baseUrl: setup.url, model: 'fake-chat-pro', key: 'sk-fake-real', apiFormat: 'openai_chat' })
      await setup.host.execute({ type: 'agent-provider', agent: 'claude', provider: 'Fake Chat' })
      await setup.host.execute({ type: 'provider-routing', app: 'claude', on: true })
      const output = await terminal(claude.path!, ['-p', 'Say hello.'], setup.workspace, { CLAUDE_CONFIG_DIR: setup.configs.claude })
      process.stdout.write(`terminal claude: ${output.trim().split('\n').slice(-3).join(' | ')} hits: ${JSON.stringify(setup.hits.map(hit => [hit.path, hit.model]))}\n`)
      expect(output).toContain('routed through Anna')
      expect(setup.hits.every(hit => hit.path === '/v1/chat/completions' && hit.authorization === 'Bearer sk-fake-real' && hit.model === 'fake-chat-pro')).toBe(true)
      await setup.host.close()
    }
    finally {
      setup.close()
    }
  }, 180000)
})
