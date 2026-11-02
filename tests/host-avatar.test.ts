import type { CredentialVault } from '../packages/anna-host/host'
import type { WorkspaceSettings } from '../packages/shared/contracts'
import { Buffer } from 'node:buffer'
import { existsSync, lstatSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Host } from '../packages/anna-host/host'
import { scriptedBackend } from '../packages/kernels/pi/backend'
import { createPiKernel } from '../packages/kernels/pi/kernel'

const picture = Buffer.from([137, 80, 78, 71, 1, 2, 3])
const job = (image = picture) => ({ type: 'avatar-job' as const, image: image.toString('base64') })
const open: Host[] = []
afterEach(async () => { await Promise.all(open.splice(0).map(host => host.close())) })

/** A host on a project of its own, saved as `saved` says; `prepare` puts in what the project already holds. */
async function opened({ saved, wait, prepare, vault = { read: async () => 'key', write: async () => {} } }: { saved?: Partial<WorkspaceSettings>, wait?: number, prepare?: (workspace: string, data: string) => Promise<void>, vault?: CredentialVault } = {}) {
  const data = await mkdtemp(join(tmpdir(), 'anna-avatar-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  await prepare?.(workspace, data)
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'haru', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://example.com', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'ask', rules: { allow: [], ask: [], deny: [] }, ...saved } } }))
  const backend = await scriptedBackend([{ text: '好的，我先看看这张图。', wait }], data)
  const host = new Host(resolve('.'), data, vault, () => {}, { sandbox: { available: false, reason: 'test' }, kernel: context => createPiKernel(context, backend) })
  await host.initialize()
  open.push(host)
  return { host, workspace, data }
}

it('handing Anna a picture puts it in her workspace and gives her the task, as ordinary work', async () => {
  const { host, workspace } = await opened()
  await host.execute(job())
  expect(await readFile(join(workspace, 'anna-avatar/source.png'))).toEqual(picture)
  const [asked] = host.snapshot().messages!
  expect(asked).toMatchObject({ role: 'user' })
  expect(asked!.text).toContain('anna-avatar/source.png')
  expect(asked!.text).toContain('mesh-avatar-studio')
  expect(asked!.text).toContain('先问我')
})

it.each([
  ['plan mode, which changes nothing', { mode: 'plan' as const }, '规划模式'],
  ['a folder not trusted yet', { trusted: false }, '信任'],
])('writes nothing in %s', async (_, saved, reason) => {
  const { host, workspace } = await opened({ saved })
  await expect(host.execute(job())).rejects.toThrow(reason)
  expect(existsSync(join(workspace, 'anna-avatar'))).toBe(false)
})

it.each([
  ['something that is not a picture', () => Buffer.from('not a picture')],
  ['a picture too large to be one she can use', () => Buffer.concat([picture, Buffer.alloc(64 * 1024 * 1024)])],
])('takes only a PNG, not %s', async (_, image) => {
  const { host, workspace } = await opened()
  await expect(host.execute(job(image()))).rejects.toThrow('PNG')
  expect(existsSync(join(workspace, 'anna-avatar'))).toBe(false)
})

it('waits while her settings are changing', async () => {
  const vault = { read: async () => 'key', write: async () => {} }
  const { host, workspace } = await opened({ vault })
  let release = () => {}
  const changing = new Promise<void>((started) => {
    vault.read = () => new Promise((resolve) => {
      started()
      release = () => resolve('key')
    })
  })
  const switching = host.execute({ type: 'kernel', id: 'pi' })
  await changing
  await expect(host.execute(job())).rejects.toThrow('手上')
  expect(existsSync(join(workspace, 'anna-avatar'))).toBe(false)
  release()
  await switching
})

it('a second picture never replaces the one she is working on', async () => {
  const { host, workspace } = await opened({ wait: 400 })
  const first = host.execute(job())
  await vi.waitFor(() => expect(host.snapshot().messages?.length).toBeGreaterThan(0))
  await expect(host.execute(job(Buffer.from([137, 80, 78, 71, 9])))).rejects.toThrow('手上')
  expect(await readFile(join(workspace, 'anna-avatar/source.png'))).toEqual(picture)
  await first
})

it('never follows a link with the picture', async () => {
  const { host, workspace, data } = await opened({
    prepare: async (workspace, data) => {
      await mkdir(join(workspace, 'anna-avatar'))
      await writeFile(join(data, 'precious.txt'), 'keep me')
      await symlink(join(data, 'precious.txt'), join(workspace, 'anna-avatar/source.png'))
    },
  })
  await host.execute(job())
  expect(await readFile(join(data, 'precious.txt'), 'utf8')).toBe('keep me')
  expect(lstatSync(join(workspace, 'anna-avatar/source.png')).isSymbolicLink()).toBe(false)
})

it('refuses when her folder itself is a link', async () => {
  const { host, data } = await opened({
    prepare: async (workspace, data) => {
      await mkdir(join(data, 'elsewhere'))
      await symlink(join(data, 'elsewhere'), join(workspace, 'anna-avatar'))
    },
  })
  await expect(host.execute(job())).rejects.toThrow('链接')
  expect(await readdir(join(data, 'elsewhere'))).toEqual([])
})
