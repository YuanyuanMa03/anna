import type { ScriptStep } from '../packages/kernels/pi/backend'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { Host } from '../packages/anna-host/host'
import { scriptedBackend } from '../packages/kernels/pi/backend'
import { createPiKernel } from '../packages/kernels/pi/kernel'

async function setup(script: ScriptStep[], together?: unknown) {
  const data = await mkdtemp(join(tmpdir(), 'anna-together-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, windowsAutoAcknowledged: true, kernel: 'pi', characterId: 'haru', statusEnabled: false, memoryEnabled: true, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'edit', rules: { allow: [], ask: [], deny: [] } } }, ...(together ? { together } : {}) }))
  let backend: Awaited<ReturnType<typeof scriptedBackend>> | undefined
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, () => {}, {
    sandbox: { available: false, reason: 'test' },
    kernel: (context) => {
      const kernel = createPiKernel(context, undefined)
      const start = kernel.start.bind(kernel)
      kernel.start = async () => {
        backend ??= await scriptedBackend(script, data)
        ;(kernel as unknown as { backend: unknown }).backend = backend
        return start()
      }
      return kernel
    },
  })
  await host.initialize()
  return { host, data }
}

it('counts their whole history from the running tally, not from the journal\'s recent window', async () => {
  const { host, data } = await setup([{ text: '好了。' }], { since: '2026-01-02T03:00:00.000Z', done: 59, firstTask: { at: '2026-01-02T03:00:00.000Z', text: '第一次的事' }, milestones: [] })
  try {
    await host.execute({ type: 'send', text: '再做一件' })
    const together = host.snapshot().relationship!
    expect(together).toMatchObject({ since: '2026-01-02T03:00:00.000Z', done: 60 })
    expect(together.moments.map(moment => moment.text)).toEqual(expect.arrayContaining(['一起完成了第 60 件事', '第一次一起完成：第一次的事', '再做一件']))
    const saved = JSON.parse(await readFile(join(data, 'settings.json'), 'utf8'))
    expect(saved.together).toMatchObject({ done: 60, milestones: [{ text: '一起完成了第 60 件事' }] })
  }
  finally { await host.close() }
})

it('starts the tally from what is on record for someone upgrading', async () => {
  const { host, data } = await setup([])
  try {
    expect(JSON.parse(await readFile(join(data, 'settings.json'), 'utf8')).together).toEqual({ done: 0, milestones: [] })
    expect(host.snapshot().relationship).toMatchObject({ days: 0, done: 0 })
  }
  finally { await host.close() }
})
