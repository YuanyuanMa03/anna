import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrate, SettingsStore, validateModel } from '../packages/anna-host/settings'
import { dataDirectory } from '../packages/shared/platform'

describe('settings', () => {
  it('round-trips v2 settings without a key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anna-settings-'))
    try {
      const store = new SettingsStore(dir)
      await store.load()
      store.value.characterId = 'mark'
      store.value.workspaces['/w'] = { trusted: true, mode: 'auto', rules: { allow: ['Bash(pnpm test)'], ask: [], deny: [] } }
      await store.save()
      const restored = new SettingsStore(dir)
      await restored.load()
      expect(restored.value).toEqual(store.value)
      expect(JSON.parse(await readFile(join(dir, 'character.json'), 'utf8'))).toEqual({ characterId: 'mark' })
      expect(await readFile(join(dir, 'settings.json'), 'utf8')).not.toContain('apiKey')
    }
    finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('migrates 0.3.0 settings: workEnabled becomes a per-workspace mode, DSH session ids are dropped', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anna-settings-'))
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ characterId: 'haru', statusEnabled: false, workEnabled: true, workspace: '/Users/x/project', sessionId: 'session-dsh', model: { provider: 'deepseek-official', model: 'deepseek-v4-flash', baseURL: 'https://api.deepseek.com/anthropic', api: 'anthropic-messages' } }))
    const store = new SettingsStore(dir)
    await store.load()
    expect(store.migratedFrom).toBe(1)
    expect(store.value).toMatchObject({ version: 2, characterId: 'haru', workspaces: { '/Users/x/project': { trusted: true, mode: 'edit' } } })
    expect(store.value).not.toHaveProperty('sessionId')
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')).version).toBe(2)
    expect(migrate({ characterId: 'hiyori', statusEnabled: true, workEnabled: false, workspace: '/p', model: { provider: 'custom', model: 'm', baseURL: 'https://e.example', api: 'openai-completions' } }).workspaces['/p']!.mode).toBe('plan')
  })
  it.each(['http://example.com', 'https://user:secret@example.com', 'https://example.com?key=secret'])('refuses credential-bearing or cleartext endpoints', (baseURL) => {
    expect(() => validateModel({ provider: 'custom', model: 'test-model', api: 'anthropic-messages', baseURL })).toThrow()
  })
  it('chooses a data directory per platform', () => {
    expect(dataDirectory('darwin', {}, '/AppData', '/Users/a')).toBe('/Users/a/.local/share/anna-dsh')
    expect(dataDirectory('linux', { XDG_DATA_HOME: '/xdg' }, '/AppData', '/home/a')).toBe('/xdg/anna')
    expect(dataDirectory('linux', {}, '/AppData', '/home/a')).toBe('/home/a/.local/share/anna')
    expect(dataDirectory('win32', {}, 'C:\\Users\\a\\AppData\\Roaming', 'C:\\Users\\a')).toContain('Anna')
    expect(dataDirectory('darwin', { ANNA_DATA_DIR: '/custom' }, '/AppData')).toBe('/custom')
  })
})
