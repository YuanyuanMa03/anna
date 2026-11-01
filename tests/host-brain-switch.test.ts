import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { Host } from '../packages/anna-host/host'
import { scriptedBackend } from '../packages/kernels/pi/backend'
import { createPiKernel } from '../packages/kernels/pi/kernel'

const settings = { version: 2, kernel: 'pi', characterId: 'haru', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://example.com', api: 'openai-completions' }, workspaces: {} }

async function setup() {
  const data = await mkdtemp(join(tmpdir(), 'anna-switch-'))
  await writeFile(join(data, 'settings.json'), JSON.stringify(settings))
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
  await host.close()
})

it('an ACP brain is refused unless the machine has asked for them', async () => {
  const host = await setup()
  await expect(host.execute({ type: 'kernel', id: 'acp:gemini' })).rejects.toThrow('暂不可用')
  expect(host.snapshot().settings.kernel).toBe('pi')
  await host.close()
})
