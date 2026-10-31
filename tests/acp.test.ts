import type { KernelContext, KernelEvent } from '../packages/kernels/types'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { AcpKernel } from '../packages/kernels/acp/kernel'
import { permissionOutcome, toolName } from '../packages/kernels/acp/protocol'

const fixture = resolve('tests/fixtures/fake-acp-agent.mjs')

async function context(overrides: Partial<KernelContext> = {}) {
  const events: KernelEvent[] = []
  const gated: { tool: string, input: Record<string, unknown> }[] = []
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
    ...overrides,
  }
  return { value, events, gated }
}

describe('acp protocol', () => {
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
  it('answers a permission request with the agent\'s own allow-once or reject-once option', () => {
    const options = [{ optionId: 'a', kind: 'allow_always' }, { optionId: 'b', kind: 'allow_once' }, { optionId: 'c', kind: 'reject_once' }]
    expect(permissionOutcome({ allow: true }, options)).toEqual({ outcome: 'selected', optionId: 'b' })
    expect(permissionOutcome({ allow: false, reason: 'no' }, options)).toEqual({ outcome: 'selected', optionId: 'c' })
    expect(permissionOutcome({ allow: false, reason: 'no' }, [{ optionId: 'a', kind: 'allow_once' }])).toEqual({ outcome: 'cancelled' })
  })
})

describe('acp kernel', () => {
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
  it('refuses to start an agent that is not installed or does not speak ACP', async () => {
    const missing = await context({ locate: async () => undefined })
    await expect(new AcpKernel(missing.value, 'gemini').start()).rejects.toThrow('Gemini CLI')
    const { value } = await context()
    expect(() => new AcpKernel(value, 'claude-desktop')).toThrow()
  })
})
