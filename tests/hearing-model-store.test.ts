import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { HearingModelStore } from '../packages/senses/model-store'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'anna-听觉 测试-'))
  homes.push(home)
  const bytes = Buffer.alloc(1024 * 1024 + 17, 42)
  const metadata = join(home, 'preload.js.metadata')
  const model = join(home, 'preload.data')
  const root = join(home, 'cache')
  await writeFile(metadata, JSON.stringify({ remote_package_size: bytes.length, files: [{ filename: '/encoder.onnx', start: 0, end: 1 }, { filename: '/decoder.onnx', start: 1, end: 2 }, { filename: '/tokens.txt', start: 2, end: bytes.length }] }))
  await writeFile(model, bytes)
  return { bytes, metadata, model, root, store: new HearingModelStore(root) }
}

it('imports once, persists across restart, reads bounded chunks and removes only the stored copy', async () => {
  const { store, root, metadata, model, bytes } = await setup()
  expect(await store.execute({ type: 'hearing-status' })).toEqual({ ok: true, hearingModel: undefined })
  const imported = await store.importFiles('import', metadata, model)
  if (!imported.ok || !imported.hearingModel)
    throw new Error('Import failed')
  const saved = imported.hearingModel
  expect(saved.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
  const restarted = new HearingModelStore(root)
  expect(await restarted.execute({ type: 'hearing-status' })).toEqual(imported)
  const first = await restarted.execute({ type: 'hearing-read', id: saved.id, offset: 0 })
  const last = await restarted.execute({ type: 'hearing-read', id: saved.id, offset: 1024 * 1024 })
  expect(first.ok && Buffer.from(first.chunk!, 'base64').length).toBe(1024 * 1024)
  expect(last.ok && Buffer.from(last.chunk!, 'base64')).toEqual(bytes.subarray(1024 * 1024))
  for (const offset of [-1, 0.5, bytes.length, Number.NaN])
    expect((await restarted.execute({ type: 'hearing-read', id: saved.id, offset })).ok).toBe(false)
  expect((await restarted.execute({ type: 'hearing-read', id: '../preload.data', offset: 0 })).ok).toBe(false)
  expect((await restarted.execute({ type: 'hearing-remove' })).ok).toBe(true)
  expect((await readFile(model)).equals(bytes)).toBe(true)
  expect(await readdir(root)).toEqual([])
})

it('preserves the previous model on cancellation or a bad replacement and cleans incomplete files', async () => {
  const { store, root, metadata, model } = await setup()
  const original = await store.importFiles('first', metadata, model)
  const canceled = store.importFiles('replacement', metadata, model)
  store.cancel('replacement')
  expect((await store.execute({ type: 'hearing-remove' })).ok).toBe(false)
  expect((await store.importFiles('duplicate', metadata, model)).ok).toBe(false)
  expect((await canceled).ok).toBe(false)
  expect(await store.execute({ type: 'hearing-status' })).toEqual(original)
  await writeFile(metadata, '{}')
  expect((await store.importFiles('bad', metadata, model)).ok).toBe(false)
  expect(await store.execute({ type: 'hearing-status' })).toEqual(original)
  expect((await readdir(root)).length).toBe(2)
})

it('allows reimport after corrupt records and never uses a stored path outside its cache', async () => {
  const { store, root, metadata, model } = await setup()
  await store.importFiles('first', metadata, model)
  await writeFile(join(root, 'current.json'), JSON.stringify({ id: '../outside', sha256: 'a'.repeat(64) }))
  expect((await store.execute({ type: 'hearing-status' })).ok).toBe(false)
  expect((await store.importFiles('recover', metadata, model)).ok).toBe(true)
  expect((await store.execute({ type: 'hearing-status' })).ok).toBe(true)
  expect((await store.execute({ type: 'hearing-remove' })).ok).toBe(true)
  expect(await readdir(root)).toEqual([])
})
