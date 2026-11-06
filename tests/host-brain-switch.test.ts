import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Host } from '../packages/anna-host/host'
import { scriptedBackend } from '../packages/kernels/pi/backend'
import { createPiKernel } from '../packages/kernels/pi/kernel'

const settings = { version: 2, kernel: 'pi', characterId: 'haru', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://example.com', api: 'openai-completions' }, workspaces: {} }

afterEach(() => vi.unstubAllEnvs())

async function setup(saved: Record<string, unknown> = settings, failSwitch = true) {
  const data = await mkdtemp(join(tmpdir(), 'anna-switch-'))
  await writeFile(join(data, 'settings.json'), JSON.stringify(saved))
  const backend = await scriptedBackend([{ text: '你好。' }, { text: '新的对话。' }], data)
  let starts = 0
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, () => {}, {
    sandbox: { available: false, reason: 'test' },
    kernel: (context) => {
      const kernel = createPiKernel(context, backend)
      // The second kernel asked for is the brain being switched to.
      return ++starts === 2 && failSwitch ? Object.assign(kernel, { start: async () => { throw new Error('没有登录') } }) : kernel
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

it('switching back resumes the history belonging to that workspace and brain', async () => {
  const host = await setup(settings, false)
  try {
    await host.execute({ type: 'send', text: '请记得这段对话' })
    const file = host.snapshot().settings.sessionFile
    await host.execute({ type: 'kernel', id: 'codex' })
    expect(host.snapshot().settings.sessionFile).not.toBe(file)
    await host.execute({ type: 'kernel', id: 'pi' })
    expect(host.snapshot().settings.sessionFile).toBe(file)
    expect(host.snapshot().restored).toBe(true)
    expect(host.snapshot().messages?.some(message => message.text === '请记得这段对话')).toBe(true)
  }
  finally { await host.close() }
})

it('restores each workspace conversation and keeps an explicitly new session when returning', async () => {
  const host = await setup(settings, false)
  try {
    await host.execute({ type: 'send', text: '留在第一个目录的对话' })
    const first = host.workspacePath
    const firstSession = host.snapshot().settings.sessionFile
    const second = join(host.data, 'second-project')
    await mkdir(second)
    await host.execute({ type: 'workspace', path: second })
    await host.execute({ type: 'trust', trusted: true })
    expect(host.snapshot().settings.sessionFile).not.toBe(firstSession)
    await host.execute({ type: 'workspace', path: first })
    expect(host.snapshot().settings.sessionFile).toBe(firstSession)
    expect(host.snapshot().messages?.some(message => message.text === '留在第一个目录的对话')).toBe(true)
    await host.execute({ type: 'new-session' })
    await host.execute({ type: 'send', text: '只留在新会话里的对话' })
    const fresh = host.snapshot().settings.sessionFile
    await host.execute({ type: 'workspace', path: second })
    await host.execute({ type: 'workspace', path: first })
    expect(host.snapshot().settings.sessionFile).toBe(fresh)
    expect(host.snapshot().messages?.some(message => message.text === '只留在新会话里的对话')).toBe(true)
    expect(host.snapshot().messages?.some(message => message.text === '留在第一个目录的对话')).toBe(false)
  }
  finally { await host.close() }
})
