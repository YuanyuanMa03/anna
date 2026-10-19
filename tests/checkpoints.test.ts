import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Checkpoints } from '../packages/anna-host/checkpoints'

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'anna-checkpoints-'))
  const workspace = join(root, 'work')
  await mkdir(workspace)
  return { root, workspace, checkpoints: new Checkpoints(join(root, 'checkpoints')) }
}

it('a whole-workspace snapshot keeps only what the task changed once it is sealed; undo still works', async () => {
  const { root, workspace, checkpoints } = await setup()
  for (const name of ['a.txt', 'b.txt', 'c.txt']) await writeFile(join(workspace, name), `${name}\n`)
  for (const name of ['a.txt', 'b.txt', 'c.txt']) await checkpoints.capture('1-aaaa', workspace, join(workspace, name))
  await writeFile(join(workspace, 'b.txt'), 'changed\n')
  await writeFile(join(workspace, 'new.txt'), 'new\n')
  await checkpoints.markCreated('1-aaaa', workspace, join(workspace, 'new.txt'))
  const changes = await checkpoints.seal('1-aaaa')
  expect(changes.map(change => [change.path, change.status])).toEqual([['b.txt', 'modified'], ['new.txt', 'added']])
  const manifest = JSON.parse(await readFile(join(root, 'checkpoints/1-aaaa/manifest.json'), 'utf8'))
  expect(manifest.entries.map((entry: { path: string }) => entry.path.split('/').at(-1))).toEqual(['b.txt', 'new.txt'])
  expect(await readdir(join(root, 'checkpoints/1-aaaa/blobs'))).toHaveLength(1)
  const { restored } = await checkpoints.undo('1-aaaa')
  expect(restored.sort()).toEqual(['b.txt', 'new.txt'])
  expect(await readFile(join(workspace, 'b.txt'), 'utf8')).toBe('b.txt\n')
  expect(existsSync(join(workspace, 'new.txt'))).toBe(false)
})

it('history older than a month goes when a task is sealed; a task id is never a path', async () => {
  const { root, workspace, checkpoints } = await setup()
  await writeFile(join(workspace, 'a.txt'), 'a\n')
  await checkpoints.capture('1-old', workspace, join(workspace, 'a.txt'))
  await writeFile(join(workspace, 'a.txt'), 'b\n')
  await checkpoints.seal('1-old')
  const old = (Date.now() - 40 * 24 * 60 * 60 * 1000) / 1000
  await utimes(join(root, 'checkpoints/1-old'), old, old)
  await checkpoints.capture('2-new', workspace, join(workspace, 'a.txt'))
  await writeFile(join(workspace, 'a.txt'), 'c\n')
  await checkpoints.seal('2-new')
  expect(await readdir(join(root, 'checkpoints'))).toEqual(['2-new'])
  await expect(checkpoints.undo('../../etc')).rejects.toThrow('无效的任务编号')
})
