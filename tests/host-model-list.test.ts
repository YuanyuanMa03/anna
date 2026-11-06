import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { Host } from '../packages/anna-host/host'

const saved = { provider: 'custom', model: 'kimi-k3', baseURL: 'https://api.moonshot.cn/v1', api: 'openai-completions' } as const

async function setup(listModels: (model: { baseURL: string, api: string }, key: string, signal: AbortSignal) => Promise<string[]>) {
  const data = await mkdtemp(join(tmpdir(), 'anna-models-'))
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'haru', statusEnabled: false, memoryEnabled: false, model: saved, workspaces: {} }))
  const written: string[] = []
  const host = new Host(resolve('.'), data, { read: async () => 'sk-saved', write: async (key: string) => { written.push(key) } }, () => {}, { sandbox: { available: false, reason: 'test' }, listModels })
  await host.initialize()
  return { host, written }
}

it('lists a vendor\'s models with the typed key and keeps the list in the snapshot, never the key', async () => {
  const list = vi.fn(async () => ['kimi-k2.7-code', 'kimi-k3'])
  const { host } = await setup(list)
  await host.execute({ type: 'model-list', model: { ...saved, baseURL: 'https://api.moonshot.cn/v1' }, key: 'sk-typed' })
  expect(list).toHaveBeenCalledWith({ baseURL: 'https://api.moonshot.cn/v1', api: 'openai-completions' }, 'sk-typed', expect.any(AbortSignal))
  expect(host.snapshot().modelList).toMatchObject({ baseURL: 'https://api.moonshot.cn/v1', api: 'openai-completions', models: ['kimi-k2.7-code', 'kimi-k3'] })
  expect(JSON.stringify(host.snapshot())).not.toContain('sk-typed')
  await host.close()
})

it('uses the saved key only for the address it was saved for', async () => {
  const list = vi.fn(async () => ['m'])
  const { host } = await setup(list)
  await host.execute({ type: 'model-list', model: { ...saved, baseURL: 'https://api.moonshot.cn/v1/' } })
  expect(list).toHaveBeenLastCalledWith(expect.anything(), 'sk-saved', expect.any(AbortSignal))
  await host.execute({ type: 'model-list', model: { ...saved, baseURL: 'https://open.bigmodel.cn/api/paas/v4' } })
  expect(list).toHaveBeenCalledTimes(1)
  expect(host.snapshot().modelList).toMatchObject({ baseURL: 'https://open.bigmodel.cn/api/paas/v4', models: [], error: expect.stringMatching(/API Key/) })
  await host.close()
})

it('shows a failed list as a message on the form instead of an error for the whole app', async () => {
  const { host } = await setup(async () => { throw new Error('API Key 无效，或者和这个服务地址不匹配') })
  await host.execute({ type: 'model-list', model: saved, key: 'sk-bad' })
  expect(host.snapshot().modelList?.error).toMatch(/API Key 无效/)
  expect(host.snapshot().error).toBeUndefined()
  await host.close()
})

it('refuses to send a saved key to a different address when the form changes vendor without a new key', async () => {
  const { host, written } = await setup(async () => [])
  await expect(host.execute({ type: 'configure', model: { ...saved, baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3' }, key: '' })).rejects.toThrow(/填写.*API Key/)
  expect(written).toEqual([])
  expect(host.snapshot().settings.model.baseURL).toBe('https://api.moonshot.cn/v1')
  await host.close()
})

it('lets only the newest request answer, and aborts the one it replaces', async () => {
  let first: AbortSignal | undefined
  let release!: () => void
  const list = vi.fn(async (_model: unknown, key: string, signal: AbortSignal) => {
    if (key === 'sk-par') {
      first = signal
      await new Promise<void>((resolve) => { release = resolve })
      throw new Error('API Key 无效，或者和这个服务地址不匹配')
    }
    return ['kimi-k3']
  })
  const { host } = await setup(list)
  const partial = host.execute({ type: 'model-list', model: saved, key: 'sk-par' })
  await vi.waitFor(() => expect(first).toBeDefined())
  await host.execute({ type: 'model-list', model: saved, key: 'sk-partial-and-complete' })
  expect(first!.aborted).toBe(true)
  release()
  await partial
  expect(host.snapshot().modelList).toMatchObject({ models: ['kimi-k3'] })
  expect(host.snapshot().modelList?.error).toBeUndefined()
  await host.close()
})

it('shows a malformed request on the form too', async () => {
  const { host } = await setup(async () => ['x'])
  await host.execute({ type: 'model-list', model: saved, key: 'bad\nkey' })
  expect(host.snapshot().modelList?.error).toMatch(/格式无效/)
  expect(host.snapshot().error).toBeUndefined()
  await host.close()
})
