import type { AgentKernel, KernelContext, TurnOutcome } from '../packages/kernels/types'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { Host } from '../packages/anna-host/host'

async function setup(hang = false) {
  const data = await mkdtemp(join(tmpdir(), 'anna-connection-'))
  const previous = join(data, 'original-session.json')
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'haru', statusEnabled: true, memoryEnabled: true, workspace: data, sessionFile: previous, model: { provider: 'custom', model: 'configured-model', baseURL: 'https://example.com', api: 'openai-completions' }, workspaces: { [data]: { trusted: true, mode: 'edit', rules: { allow: [], ask: [], deny: [] } } } }))
  let probe: KernelContext | undefined
  let probeMode: string | undefined
  let writeDenied = false
  let resolveProbe: ((result: TurnOutcome) => void) | undefined
  const host = new Host(resolve('.'), data, { read: async () => 'fixture-key', write: async () => {} }, () => {}, {
    sandbox: { available: false, reason: 'fixture' },
    kernel: (context): AgentKernel => ({
      capabilities: { id: 'pi', label: 'fixture', sessions: true, steering: false, shell: 'bash' },
      sessionId: 'fixture',
      sessionFile: context.sessionFile ?? join(data, 'probe.json'),
      restored: false,
      tools: [],
      plugins: [],
      start: async () => {},
      close: async () => {},
      note: () => {},
      remember: () => {},
      history: () => [],
      steer: async () => {},
      abort: async () => { resolveProbe?.({ status: 'aborted', text: '' }) },
      prompt: async () => {
        probe = context
        probeMode = context.mode?.()
        writeDenied = !(await context.gate('write', { path: join(data, 'blocked.txt'), content: 'blocked' }, 'probe-write')).allow
        return hang ? new Promise<TurnOutcome>((resolve) => { resolveProbe = resolve }) : { status: 'completed', text: '你好' }
      },
    }),
  })
  await host.initialize()
  return { host, data, previous, probe: () => probe, safety: () => ({ mode: probeMode, writeDenied }) }
}
it('verifies with no Anna tools, denies file modification and preserves the original conversation', async () => {
  const { host, previous, probe, safety } = await setup()
  try {
    await host.execute({ type: 'connection-test' })
    expect(probe()?.sessionFile).toBeUndefined()
    expect(probe()?.tools).toEqual([])
    expect(safety()).toEqual({ mode: 'plan', writeDenied: true })
    expect(host.snapshot().settings.sessionFile).toBe(previous)
    expect(host.snapshot().settings.connectionVerified).toBe('pi')
  }
  finally { await host.close() }
})
it('reports timeout without discarding the model or verifying the connection', async () => {
  const { host, previous, data } = await setup(true)
  const original = globalThis.setTimeout
  const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => original(callback, delay === 60000 ? 5 : delay, ...args)) as typeof setTimeout)
  try {
    await expect(host.execute({ type: 'connection-test' })).rejects.toThrow('连接验证超时')
    const saved = JSON.parse(await readFile(join(data, 'settings.json'), 'utf8'))
    expect(saved.model.model).toBe('configured-model')
    expect(saved.sessionFile).toBe(previous)
    expect(saved.connectionVerified).toBeUndefined()
  }
  finally { timer.mockRestore(); await host.close() }
})
