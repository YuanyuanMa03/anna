import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsStore, validateModel } from '../packages/anna-host/settings'

describe('settings persistence', () => {
  it('restores character, plugin selection and session reference without a key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anna-settings-'))
    try {
      const store = new SettingsStore(dir)
      await store.load()
      store.value.characterId = 'mark'
      store.value.statusEnabled = false
      store.value.sessionId = 'synthetic-session-for-validation'
      await store.save()
      const restored = new SettingsStore(dir)
      await restored.load()
      expect(restored.value).toEqual(store.value)
      expect(JSON.parse(await readFile(join(dir, 'character.json'), 'utf8'))).toEqual({ characterId: 'mark' })
      expect(await readFile(join(dir, 'settings.json'), 'utf8')).not.toContain('apiKey')
    }
    finally { await rm(dir, { recursive: true, force: true }) }
  })
  it.each(['http://example.com', 'https://user:secret@example.com', 'https://example.com?key=secret'])('refuses credential-bearing or cleartext endpoints', (baseURL) => {
    expect(() => validateModel({ provider: 'custom', model: 'test-model', api: 'anthropic-messages', baseURL })).toThrow()
  })
})
