import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { Host } from '../packages/anna-host/host'
import { scriptedBackend } from '../packages/kernels/pi/backend'
import { createPiKernel } from '../packages/kernels/pi/kernel'

it('handing Anna a picture puts it in her workspace and gives her the task, as ordinary work', async () => {
  const data = await mkdtemp(join(tmpdir(), 'anna-avatar-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'haru', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://example.com', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'ask', rules: { allow: [], ask: [], deny: [] } } } }))
  const backend = await scriptedBackend([{ text: '好的，我先看看这张图。' }], data)
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, () => {}, { sandbox: { available: false, reason: 'test' }, kernel: context => createPiKernel(context, backend) })
  await host.initialize()
  const picture = Buffer.from([137, 80, 78, 71, 1, 2, 3])
  await host.execute({ type: 'avatar-job', image: picture.toString('base64') })
  expect(await readFile(join(workspace, 'anna-avatar/source.png'))).toEqual(picture)
  const [asked] = host.snapshot().messages!
  expect(asked).toMatchObject({ role: 'user' })
  expect(asked!.text).toContain('anna-avatar/source.png')
  expect(asked!.text).toContain('mesh-avatar-studio')
  expect(asked!.text).toContain('先问我')
  await host.close()
})
