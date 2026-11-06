import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { Host } from '../packages/anna-host/host'

it('opens unconfigured when the saved key cannot be decrypted, leaving the file alone', async () => {
  const data = await mkdtemp(join(tmpdir(), 'anna-startup-'))
  let writes = 0
  const host = new Host(resolve('.'), data, { read: () => Promise.reject(new Error('decrypt failed')), write: async () => { writes++ } }, () => {}, { sandbox: { available: false, reason: 'test' } })
  await expect(host.initialize()).resolves.toBeUndefined()
  expect(host.snapshot().state).toBe('unconfigured')
  expect(writes).toBe(0)
  await host.shutdown()
})

it('opens with empty memory when its file is corrupt', async () => {
  const data = await mkdtemp(join(tmpdir(), 'anna-startup-'))
  await writeFile(join(data, 'memory.json'), '{}')
  await writeFile(join(data, 'journal.json'), 'null')
  const host = new Host(resolve('.'), data, { read: async () => '', write: async () => {} }, () => {}, { sandbox: { available: false, reason: 'test' } })
  await expect(host.initialize()).resolves.toBeUndefined()
  expect(await readdir(join(data, 'quarantine'))).toHaveLength(2)
  expect((host as unknown as { memory: { items: unknown[] } }).memory.items).toEqual([])
  const guarded = (host as unknown as { protectedPaths: () => string[] }).protectedPaths()
  for (const folder of ['logs', 'quarantine'])
    expect(guarded).toContain(join(data, folder))
  await host.shutdown()
})
