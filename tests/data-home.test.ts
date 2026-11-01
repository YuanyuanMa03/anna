import { existsSync, lstatSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { moveDataHome } from '../packages/anna-host/data-home'
import { defaultSettings, migrate } from '../packages/anna-host/settings'
import { dataDirectory, earlierDataDirectory } from '../packages/shared/platform'

const saved = { version: 2, kernel: 'codex', characterId: 'haru', statusEnabled: true, memoryEnabled: false, reviewDelegations: true, sessionFile: '/old/session.jsonl', model: { provider: 'custom', model: 'glm-5.3', baseURL: 'https://open.bigmodel.cn/api/anthropic', api: 'anthropic-messages' }, modelVerified: true, workspace: '/Users/a/project', workspaces: { '/Users/a/project': { trusted: true, mode: 'edit', rules: { allow: [], ask: [], deny: [] } } }, routing: { global: { codex: true } } }

let root = ''
async function home(settings: unknown = saved) {
  root = await mkdtemp(join(tmpdir(), 'anna data home '))
  const from = join(root, '.local/share/anna-dsh')
  await mkdir(join(from, 'agent-backups/codex'), { recursive: true })
  await writeFile(join(from, 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings))
  await writeFile(join(from, 'journal.json'), '{"tasks":1}')
  await writeFile(join(from, 'memory.json'), '{"items":[]}')
  await writeFile(join(from, 'credential.bin'), 'sealed-key')
  await writeFile(join(from, 'agent-backups/codex/config.toml'), 'model = "mine"')
  return { from, to: join(root, 'Library/Application Support/Anna') }
}
afterEach(() => rm(root, { recursive: true, force: true }))

describe('where her data lives', () => {
  it('is the platform\'s own place for app data on macOS and Windows, and XDG on Linux', () => {
    expect(dataDirectory('darwin', {}, '/Users/a/Library/Application Support', '/Users/a')).toBe('/Users/a/Library/Application Support/Anna')
    expect(dataDirectory('win32', {}, 'C:\\Users\\a\\AppData\\Roaming', 'C:\\Users\\a')).toBe('C:\\Users\\a\\AppData\\Roaming\\Anna')
    expect(dataDirectory('linux', {}, '/home/a/.config', '/home/a')).toBe('/home/a/.local/share/anna')
  })

  it('remembers where macOS releases up to 0.5 kept it, unless a folder was asked for', () => {
    expect(earlierDataDirectory('darwin', {}, '/Users/a')).toBe('/Users/a/.local/share/anna-dsh')
    expect(earlierDataDirectory('darwin', { ANNA_DATA_DIR: '/custom' }, '/Users/a')).toBeUndefined()
    expect(earlierDataDirectory('win32', {}, 'C:\\Users\\a')).toBeUndefined()
    expect(earlierDataDirectory('linux', {}, '/home/a')).toBeUndefined()
  })
})

describe('moving the data of an earlier release', () => {
  it('brings everything along and leaves a link, so paths other programs saved keep working', async () => {
    const { from, to } = await home()
    expect(moveDataHome(from, to)).toBe(true)
    expect(await readFile(join(to, 'journal.json'), 'utf8')).toBe('{"tasks":1}')
    expect(await readFile(join(to, 'agent-backups/codex/config.toml'), 'utf8')).toBe('model = "mine"')
    expect(lstatSync(from).isSymbolicLink()).toBe(true)
    expect(await readFile(join(from, 'journal.json'), 'utf8')).toBe('{"tasks":1}')
  })

  it('starts her brain fresh: no saved model, key or session, whatever brain was on', async () => {
    const { from, to } = await home()
    moveDataHome(from, to)
    const settings = migrate(JSON.parse(await readFile(join(to, 'settings.json'), 'utf8')))
    expect(settings.kernel).toBe('pi')
    expect(settings.model).toEqual(defaultSettings().model)
    expect(settings.modelVerified).toBeUndefined()
    expect(settings.sessionFile).toBeUndefined()
    expect(existsSync(join(to, 'credential.bin'))).toBe(false)
    expect(await readFile(join(to, 'settings.json'), 'utf8')).not.toContain('glm')
  })

  it('keeps everything else about the person, and the old brain set aside', async () => {
    const { from, to } = await home()
    moveDataHome(from, to)
    const settings = migrate(JSON.parse(await readFile(join(to, 'settings.json'), 'utf8')))
    expect(settings).toMatchObject({ memoryEnabled: false, workspace: '/Users/a/project', routing: { global: { codex: true } } })
    expect(settings.workspaces['/Users/a/project']!.mode).toBe('edit')
    expect(JSON.parse(await readFile(join(to, 'before-0.6/settings.json'), 'utf8')).model.model).toBe('glm-5.3')
    expect(await readFile(join(to, 'before-0.6/credential.bin'), 'utf8')).toBe('sealed-key')
  })

  it('does nothing when there is no earlier release', async () => {
    root = await mkdtemp(join(tmpdir(), 'anna data home '))
    expect(moveDataHome(join(root, 'missing'), join(root, 'Anna'))).toBe(false)
    expect(existsSync(join(root, 'Anna'))).toBe(false)
  })

  it('never touches a new home that already exists', async () => {
    const { from, to } = await home()
    await mkdir(to, { recursive: true })
    await writeFile(join(to, 'settings.json'), '{"mine":true}')
    expect(moveDataHome(from, to)).toBe(false)
    expect(await readFile(join(to, 'settings.json'), 'utf8')).toBe('{"mine":true}')
    expect(lstatSync(from).isSymbolicLink()).toBe(false)
  })

  it('happens once: the next launch does nothing, even if the new home was deleted to start over', async () => {
    const { from, to } = await home()
    moveDataHome(from, to)
    expect(moveDataHome(from, to)).toBe(false)
    await rm(to, { recursive: true })
    expect(moveDataHome(from, to)).toBe(false)
    expect(existsSync(to)).toBe(false)
  })

  it('still moves a settings file it cannot read, for the host to report', async () => {
    const { from, to } = await home('{not json')
    expect(moveDataHome(from, to)).toBe(true)
    expect(await readFile(join(to, 'settings.json'), 'utf8')).toBe('{not json')
  })
})
