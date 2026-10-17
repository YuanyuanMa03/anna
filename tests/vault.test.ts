import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createVault } from '../packages/shared/vault'

/** A stand-in for Electron's safeStorage that counts how often the OS key store is touched. */
function fakeSafeStorage(backend: string, available = true) {
  const calls = { decrypt: 0, encrypt: 0 }
  return {
    calls,
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (value: string) => { calls.encrypt++; return Buffer.from(`enc:${value}`) },
    decryptString: (buffer: Buffer) => { calls.decrypt++; return buffer.toString().replace(/^enc:/, '') },
  }
}

describe('vault', () => {
  it('encrypts with the OS store and decrypts each secret only once per process', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anna-vault-'))
    const safe = fakeSafeStorage('keychain')
    const vault = createVault({ dir, safeStorage: safe, platform: 'darwin' })
    await vault.write('credential.bin', 'sk-1')
    expect((await readFile(join(dir, 'credential.bin'))).toString()).toBe('enc:sk-1')
    const fresh = createVault({ dir, safeStorage: safe, platform: 'darwin' })
    expect(await fresh.read('credential.bin')).toBe('sk-1')
    expect(await fresh.read('credential.bin')).toBe('sk-1')
    expect(safe.calls.decrypt).toBe(1)
    expect(fresh.mode()).toBe('system')
  })

  it('falls back to a private 0600 file on Linux without a keyring, and says so', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anna-vault-'))
    const vault = createVault({ dir, safeStorage: fakeSafeStorage('basic_text'), platform: 'linux' })
    await vault.write('credential.bin', 'sk-2')
    expect(vault.mode()).toBe('file')
    expect(((await stat(join(dir, 'credential.bin'))).mode & 0o777).toString(8)).toBe('600')
    expect(await createVault({ dir, safeStorage: fakeSafeStorage('basic_text'), platform: 'linux' }).read('credential.bin')).toBe('sk-2')
  })

  it('refuses to store secrets in plain files on macOS and Windows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anna-vault-'))
    await expect(createVault({ dir, safeStorage: fakeSafeStorage('', false), platform: 'darwin' }).write('credential.bin', 'x')).rejects.toThrow(/凭据存储不可用/)
  })
})
