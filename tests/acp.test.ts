import type { KernelContext, KernelEvent } from '../packages/kernels/types'
import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { AcpKernel } from '../packages/kernels/acp/kernel'
import { Connection, permissionOutcome, toolInput, toolName, toolOutput } from '../packages/kernels/acp/protocol'

const fixture = resolve('tests/fixtures/fake-acp-agent.mjs')

async function context(overrides: Partial<KernelContext> = {}) {
  const events: KernelEvent[] = []
  const gated: { tool: string, input: Record<string, unknown> }[] = []
  const wrapped: string[] = []
  const data = await mkdtemp(join(tmpdir(), 'anna-acp-'))
  const value: KernelContext = {
    root: process.cwd(),
    data,
    workspace: data,
    trusted: true,
    model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' },
    key: '',
    instructions: ['你是 Anna。'],
    gate: async (tool, input) => {
      gated.push({ tool, input })
      return { allow: true }
    },
    tools: [],
    emit: event => events.push(event),
    locate: async () => ({ command: process.execPath, prefix: [fixture] }),
    // The real sandbox (Seatbelt, bubblewrap) is the host's; here it records the command it would wrap and runs it as is.
    sandbox: { wrap: async (command) => {
      wrapped.push(command)
      return command
    } },
    ...overrides,
  }
  return { value, events, gated, wrapped }
}

it.skipIf(process.platform === 'win32')('finds what the agent\'s own folder holds, as an npm-installed agent needs when the app has no shell PATH', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'anna-acp-bin-'))
  await symlink(process.execPath, join(dir, 'its-own-node'))
  await writeFile(join(dir, 'agent'), `#!/bin/sh\nexec its-own-node ${JSON.stringify(fixture)}\n`)
  await chmod(join(dir, 'agent'), 0o755)
  const { value } = await context({ locate: async () => ({ command: join(dir, 'agent') }) })
  const kernel = new AcpKernel(value, 'gemini')
  await expect(kernel.start()).resolves.not.toThrow()
  await kernel.close()
})

describe('acp protocol', () => {
  it('ignores what an agent prints that is JSON but no message, and a null content block', async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough() })
    const seen: string[] = []
    const connection = new Connection(child as never, { request: async () => null, notify: method => seen.push(method) })
    expect(connection).toBeDefined()
    child.stdout.write(Buffer.from('null\n42\n"text"\n{"method":"ping"}\n'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(seen).toEqual(['ping'])
    expect(toolOutput([null, { content: { text: 'kept' } }])).toBe('kept')
  })
  it('survives writing to an agent that has died', () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough() })
    expect(new Connection(child as never, { request: async () => null, notify: () => {} })).toBeDefined()
    expect(() => child.stdin.emit('error', new Error('EPIPE'))).not.toThrow()
  })
  it('maps ACP tool kinds onto Anna\'s tool names', () => {
    expect(toolName('execute')).toBe('bash')
    expect(toolName('read')).toBe('read')
    expect(toolName('edit')).toBe('edit')
    expect(toolName('delete')).toBe('edit')
    expect(toolName('move')).toBe('edit')
    expect(toolName('search')).toBe('grep')
    expect(toolName('fetch')).toBe('fetch')
    expect(toolName(undefined)).toBe('other')
  })
  it('treats a file call whose path it cannot tell as outside the workspace', () => {
    expect(toolInput({ toolCallId: 'x', kind: 'edit', rawInput: { content: 'x' } })).toEqual({ content: 'x', path: '/' })
    expect(toolInput({ toolCallId: 'x', kind: 'edit', locations: [{ path: 'a.md' }] })).toEqual({ path: 'a.md' })
    expect(toolInput({ toolCallId: 'x', kind: 'execute', rawInput: { command: 'ls' } })).toEqual({ command: 'ls' })
  })
  it('answers a permission request with the agent\'s own allow-once or reject-once option', () => {
    const options = [{ optionId: 'a', kind: 'allow_always' }, { optionId: 'b', kind: 'allow_once' }, { optionId: 'c', kind: 'reject_once' }]
    expect(permissionOutcome({ allow: true }, options)).toEqual({ outcome: 'selected', optionId: 'b' })
    expect(permissionOutcome({ allow: false, reason: 'no' }, options)).toEqual({ outcome: 'selected', optionId: 'c' })
    expect(permissionOutcome({ allow: false, reason: 'no' }, [{ optionId: 'a', kind: 'allow_once' }])).toEqual({ outcome: 'cancelled' })
  })
})

// Windows has no sandbox, so no ACP brain is offered or started there; the agent-process tests run on macOS and Linux.
describe.skipIf(process.platform === 'win32')('acp kernel', () => {
  it('runs a turn: streams her words, passes the tool call through Anna\'s gate, keeps the transcript', async () => {
    const { value, events, gated } = await context({ instructions: [] })
    const kernel = new AcpKernel(value, 'gemini')
    await kernel.start()
    const outcome = await kernel.prompt('看看文件夹', { origin: 'desktop' })
    expect(outcome).toMatchObject({ status: 'completed', text: 'ran for: 看看文件夹' })
    expect(gated).toEqual([{ tool: 'bash', input: { command: 'ls -a' } }])
    expect(events.some(event => event.type === 'thinking')).toBe(true)
    expect(events).toContainEqual({ type: 'tool-start', id: 't1', name: 'bash', input: { command: 'ls -a' } })
    expect(events).toContainEqual({ type: 'tool-end', id: 't1', name: 'bash', output: 'notes.md', isError: false })
    expect(kernel.history().map(message => message.text)).toEqual(['看看文件夹', 'ran for: 看看文件夹'])
    expect(kernel.capabilities).toMatchObject({ id: 'acp:gemini', label: 'Gemini CLI' })
    await kernel.close()
  })
  it('sends Anna\'s instructions ahead of the first message only', async () => {
    const { value } = await context()
    const kernel = new AcpKernel(value, 'gemini')
    await kernel.start()
    expect((await kernel.prompt('一', { origin: 'desktop' })).text).toContain('你是 Anna。')
    expect((await kernel.prompt('二', { origin: 'desktop' })).text).not.toContain('你是 Anna。')
    await kernel.close()
  })
  it('rejects the tool call when Anna\'s gate says no', async () => {
    const { value, events } = await context({ instructions: [], gate: async () => ({ allow: false, reason: 'plan mode' }) })
    const kernel = new AcpKernel(value, 'gemini')
    await kernel.start()
    expect((await kernel.prompt('看看', { origin: 'desktop' })).text).toBe('skipped for: 看看')
    expect(events).toContainEqual({ type: 'tool-end', id: 't1', name: 'bash', output: 'rejected', isError: true })
    await kernel.close()
  })
  it('cancels a running turn when aborted', async () => {
    const { value } = await context()
    const kernel = new AcpKernel(value, 'gemini')
    await kernel.start()
    const turn = kernel.prompt('slow work', { origin: 'desktop' })
    await new Promise(done => setTimeout(done, 300))
    await kernel.abort()
    expect((await turn).status).toBe('aborted')
    await kernel.close()
  })
  it('reports an agent that needs a login in words the person can act on', async () => {
    const { value } = await context()
    const kernel = new AcpKernel(value, 'gemini')
    await kernel.start()
    const outcome = await kernel.prompt('login please', { origin: 'desktop' })
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('Gemini CLI')
    await kernel.close()
  })
  it('fails to start, rather than hang or crash, when the agent cannot be launched', async () => {
    const { value } = await context({ locate: async () => ({ command: '/nonexistent/acp-agent' }) })
    await expect(new AcpKernel(value, 'gemini').start()).rejects.toThrow('Gemini CLI')
  })
  it('fails the next turn, rather than hang, when the agent has died between turns', async () => {
    const { value } = await context({ instructions: [] })
    const kernel = new AcpKernel(value, 'gemini')
    await kernel.start()
    ;(kernel as unknown as { child: { kill: () => void } }).child.kill()
    await new Promise(done => setTimeout(done, 200))
    const outcome = await kernel.prompt('还在吗', { origin: 'desktop' })
    expect(outcome.status).toBe('failed')
    await kernel.close()
  })
  it('tells a new session what the restored conversation was about', async () => {
    const first = await context({ instructions: [] })
    const kernel = new AcpKernel(first.value, 'gemini')
    await kernel.start()
    await kernel.prompt('记住我喜欢紫色', { origin: 'desktop' })
    await kernel.close()
    const again = new AcpKernel({ ...first.value, sessionFile: kernel.sessionFile }, 'gemini')
    await again.start()
    expect(again.restored).toBe(true)
    expect((await again.prompt('我喜欢什么颜色', { origin: 'desktop' })).text).toContain('记住我喜欢紫色')
    await again.close()
  })
  it('runs the agent inside Anna\'s sandbox, and refuses to run it without one', async () => {
    const { value, wrapped } = await context()
    const kernel = new AcpKernel(value, 'gemini')
    await kernel.start()
    expect(wrapped).toHaveLength(1)
    expect(wrapped[0]).toContain(fixture)
    expect(wrapped[0]).toContain('--acp')
    await kernel.close()
    const bare = await context({ sandbox: undefined })
    await expect(new AcpKernel(bare.value, 'gemini').start()).rejects.toThrow('沙箱')
  })
  it('stops the turn when the agent changes something without asking her first', async () => {
    const { value } = await context({ instructions: [] })
    const kernel = new AcpKernel(value, 'gemini')
    await kernel.start()
    const outcome = await kernel.prompt('sneaky edit', { origin: 'desktop' })
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('没有先征得同意')
    await kernel.close()
  })
  it('still passes a read the agent did not ask about through her gate', async () => {
    const { value, gated } = await context({ instructions: [] })
    const kernel = new AcpKernel(value, 'gemini')
    await kernel.start()
    expect((await kernel.prompt('peek', { origin: 'desktop' })).status).toBe('completed')
    expect(gated).toEqual([{ tool: 'read', input: { path: 'notes.md' } }])
    await kernel.close()
  })
  it('stops the turn when her gate fails while checking an unasked read', async () => {
    const { value } = await context({ instructions: [], gate: async () => {
      throw new Error('gate down')
    } })
    const kernel = new AcpKernel(value, 'gemini')
    await kernel.start()
    const outcome = await kernel.prompt('peek', { origin: 'desktop' })
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('没能核对')
    await kernel.close()
  })
  it('waits for a slow gate: a refusal after the agent finished still fails the turn', async () => {
    const { value } = await context({ instructions: [], gate: async () => {
      await new Promise(done => setTimeout(done, 300))
      return { allow: false, reason: '受保护的路径' }
    } })
    const kernel = new AcpKernel(value, 'gemini')
    await kernel.start()
    const outcome = await kernel.prompt('peek', { origin: 'desktop' })
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('受保护的路径')
    await kernel.close()
  })
  it('refuses to start an agent that is not installed or does not speak ACP', async () => {
    const missing = await context({ locate: async () => undefined })
    await expect(new AcpKernel(missing.value, 'gemini').start()).rejects.toThrow('Gemini CLI')
    const { value } = await context()
    expect(() => new AcpKernel(value, 'claude-desktop')).toThrow()
  })
})
