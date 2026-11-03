import type { HistoryOptions } from '../packages/agents/history'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, expect, it, vi } from 'vitest'
import { codexCapabilities } from '../packages/agents/capabilities'
import { ExternalHistory } from '../packages/agents/history'

const digest = (text: string) => createHash('sha256').update(text).digest('hex')
afterEach(() => vi.unstubAllEnvs())

it('lists, previews and forks Claude history with the real SDK without changing its source', async () => {
  const data = await realpath(await mkdtemp(join(tmpdir(), 'anna-history-')))
  const workspace = join(data, 'project')
  const config = join(data, 'claude')
  await mkdir(workspace)
  vi.stubEnv('CLAUDE_CONFIG_DIR', config)
  const project = join(config, 'projects', workspace.replace(/[^a-z0-9]/gi, '-'))
  await mkdir(project, { recursive: true })
  const id = randomUUID()
  const userId = randomUUID()
  const file = join(project, `${id}.jsonl`)
  const source = `${[
    { type: 'user', uuid: userId, parentUuid: null, sessionId: id, cwd: workspace, isSidechain: false, message: { role: 'user', content: '整理我的项目' }, timestamp: new Date().toISOString() },
    { type: 'assistant', uuid: randomUUID(), parentUuid: userId, sessionId: id, cwd: workspace, isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: '这是原 agent 的回复。' }] }, timestamp: new Date().toISOString() },
  ].map(row => JSON.stringify(row)).join('\n')}\n`
  await writeFile(file, source)
  const history = new ExternalHistory({ locate: async () => undefined })
  await expect(history.preview('claude', id, workspace)).rejects.toThrow('先在历史列表')
  const list = await history.list('claude', workspace, false)
  expect(list.items.some(item => item.id === id)).toBe(true)
  const preview = await history.preview('claude', id, workspace)
  expect(preview.messages.map(item => item.text)).toEqual(['整理我的项目', '这是原 agent 的回复。'])
  const fork = JSON.parse(await readFile(await history.fork('claude', id, workspace, data), 'utf8'))
  expect(fork.agentSessionId).not.toBe(id)
  expect(fork.source).toMatchObject({ agent: 'claude', id })
  expect(digest(await readFile(file, 'utf8'))).toBe(digest(source))
  expect(fork.entries.at(-1).data.text).toContain('此前内容来自原 agent')
})

it('requires the selected session directory before branching', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'anna-history-other-'))
  const sessionWorkspace = join(workspace, 'missing')
  const history = new ExternalHistory({ locate: async () => undefined, claude: async () => ({ listSessions: async () => [{ sessionId: 'test', summary: 'old', lastModified: Date.now(), cwd: sessionWorkspace }], getSessionMessages: vi.fn(), forkSession: vi.fn() }) } as HistoryOptions)
  await history.list('claude', workspace, true)
  await expect(history.fork('claude', 'test', workspace, workspace)).rejects.toThrow('工作目录')
})

async function codexFixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'anna-codex-history-'))
  const file = join(cwd, 'codex.mjs')
  const log = join(cwd, 'calls.jsonl')
  await writeFile(file, `import { createInterface } from 'node:readline'; import { appendFileSync } from 'node:fs';
const out = (id, result) => process.stdout.write(JSON.stringify({id,result})+'\\n');
createInterface({ input:process.stdin }).on('line', line => { const m=JSON.parse(line); appendFileSync(${JSON.stringify(log)}, line+'\\n');
switch(m.method) {
case 'initialize': out(m.id,{}); break;
case 'thread/list': out(m.id,{data:[{id:'original',cwd:${JSON.stringify(cwd)},name:'original title',updatedAt:1700000000}],nextCursor:'next'});break;
case 'thread/items/list': out(m.id,{data:[{item:{type:'userMessage',content:[{type:'text',text:'original task'}]}},{item:{type:'agentMessage',text:'original result'}}]});break;
case 'thread/fork': out(m.id,{thread:{id:'new-anna-branch'}}); break;
case 'skills/list': out(m.id,{data:[{skills:[{name:'example-skill',path:'/skills/example',enabled:true}],errors:[]}]});break;
case 'mcpServerStatus/list': out(m.id,{data:[{name:'example-mcp',authStatus:'notLoggedIn',tools:{}}]});break;
}
});`)
  return { cwd, location: { command: process.execPath, prefix: [file] }, log }
}

it('pages Codex history and creates a native fork without sending a turn or resuming the source', async () => {
  const { cwd, location, log } = await codexFixture()
  const history = new ExternalHistory({ locate: async () => location })
  const page = await history.list('codex', cwd, false)
  expect(page.nextCursor).toBe('next')
  expect((await history.preview('codex', 'original', cwd)).messages.map(item => item.text)).toEqual(['original task', 'original result'])
  const transcript = JSON.parse(await readFile(await history.fork('codex', 'original', cwd, cwd), 'utf8'))
  expect(transcript.agentSessionId).toBe('new-anna-branch')
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  expect(calls.some(call => ['turn/start', 'thread/resume'].includes(call.method))).toBe(false)
  expect(calls.find(call => call.method === 'thread/list').params.cwd).toBe(cwd)
  expect(calls.find(call => call.method === 'thread/fork').params.threadId).toBe('original')
})

it('reports stable Codex skill and MCP metadata without calling the unsupported plugin API', async () => {
  const { cwd, location, log } = await codexFixture()
  const report = await codexCapabilities(location, cwd)
  expect(report.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'skill', name: 'example-skill', state: 'available' }),
    expect.objectContaining({ kind: 'mcp', name: 'example-mcp', state: 'configured' }),
  ]))
  expect(report.unknown).toContain('plugins')
  expect(await readFile(log, 'utf8')).not.toContain('plugin/list')
})

it('uses an explicitly confirmed replacement directory when the source directory has moved', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'anna-history-remap-'))
  const forkSession = vi.fn(async () => ({ sessionId: 'replacement-branch' }))
  const history = new ExternalHistory({ locate: async () => undefined, claude: async () => ({ listSessions: async () => [{ sessionId: 'old', summary: 'moved', lastModified: Date.now(), cwd: join(workspace, 'missing') }], getSessionMessages: async () => [], forkSession }) } as HistoryOptions)
  await history.list('claude', workspace, true)
  await expect(history.fork('claude', 'old', workspace, workspace)).rejects.toThrow('工作目录')
  expect(forkSession).not.toHaveBeenCalled()
  const file = await history.fork('claude', 'old', workspace, workspace, true)
  expect(JSON.parse(await readFile(file, 'utf8')).agentSessionId).toBe('replacement-branch')
})

it('does not silently resume the source if a fork implementation returns its original id', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'anna-history-fork-fail-'))
  const history = new ExternalHistory({ locate: async () => undefined, claude: async () => ({ listSessions: async () => [{ sessionId: 'source', summary: 'source', lastModified: Date.now(), cwd: workspace }], getSessionMessages: async () => [], forkSession: async () => ({ sessionId: 'source' }) }) } as HistoryOptions)
  await history.list('claude', workspace, false)
  await expect(history.fork('claude', 'source', workspace, workspace)).rejects.toThrow('原会话没有被续接')
})
