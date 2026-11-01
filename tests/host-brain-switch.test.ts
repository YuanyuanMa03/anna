import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Host } from '../packages/anna-host/host'
import { scriptedBackend } from '../packages/kernels/pi/backend'
import { createPiKernel } from '../packages/kernels/pi/kernel'

const settings = { version: 2, kernel: 'pi', characterId: 'haru', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://example.com', api: 'openai-completions' }, workspaces: {} }

afterEach(() => vi.unstubAllEnvs())

async function setup(saved: Record<string, unknown> = settings) {
  const data = await mkdtemp(join(tmpdir(), 'anna-switch-'))
  await writeFile(join(data, 'settings.json'), JSON.stringify(saved))
  const backend = await scriptedBackend([{ text: '你好。' }], data)
  let starts = 0
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, () => {}, {
    sandbox: { available: false, reason: 'test' },
    kernel: (context) => {
      const kernel = createPiKernel(context, backend)
      // The second kernel asked for is the brain being switched to.
      return ++starts === 2 ? Object.assign(kernel, { start: async () => { throw new Error('没有登录') } }) : kernel
    },
  })
  await host.initialize()
  return host
}

it('a brain that cannot start leaves her with the one she had, and its conversation', async () => {
  const host = await setup()
  await host.execute({ type: 'send', text: '你好' })
  const session = host.snapshot().settings.sessionFile
  expect(session).toBeTruthy()
  await expect(host.execute({ type: 'kernel', id: 'codex' })).rejects.toThrow('没有登录')
  expect(host.snapshot().settings).toMatchObject({ kernel: 'pi', sessionFile: session })
  expect(host.snapshot().state).toBe('ready')
  await host.close()
})

it('an ACP brain is refused unless the machine has asked for them', async () => {
  vi.stubEnv('ANNA_ACP', '')
  const host = await setup()
  await expect(host.execute({ type: 'kernel', id: 'acp:gemini' })).rejects.toThrow('暂不可用')
  expect(host.snapshot().settings.kernel).toBe('pi')
  await host.close()
})

it('a saved ACP brain does not start while they are off: she falls back to pi', async () => {
  vi.stubEnv('ANNA_ACP', '')
  const host = await setup({ ...settings, kernel: 'acp:gemini' })
  expect(host.snapshot().settings.kernel).toBe('pi')
  await host.close()
})
