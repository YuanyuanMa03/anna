import { Buffer } from 'node:buffer'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The part of Electron's safeStorage the vault uses (injectable for tests). */
export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean
  getSelectedStorageBackend?: () => string
  encryptString: (value: string) => Buffer
  decryptString: (buffer: Buffer) => string
}

const plainMarker = 'ANNA-PLAINTEXT-0600\n'

/**
 * Secrets encrypted by the OS store (Keychain, DPAPI, libsecret). Each secret is decrypted at most once per process.
 * On Linux without a keyring (Electron falls back to `basic_text`), secrets go to a 0600 file marked as plaintext,
 * and `mode()` reports it so the UI can say so. macOS and Windows never fall back to plaintext.
 */
export function createVault(options: { dir: string, safeStorage: SafeStorageLike, platform: NodeJS.Platform }) {
  const { dir, safeStorage, platform } = options
  const cache = new Map<string, string>()
  const fileMode = () => platform === 'linux' && (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text')
  return {
    mode: (): 'system' | 'file' => fileMode() ? 'file' : 'system',
    async read(name: string) {
      if (cache.has(name))
        return cache.get(name)!
      let bytes: Buffer
      try { bytes = await readFile(join(dir, name)) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          return ''
        throw error
      }
      let value = ''
      if (bytes.length === 0) {
        value = ''
      }
      else if (bytes.toString('utf8', 0, plainMarker.length) === plainMarker) {
        value = bytes.toString('utf8').slice(plainMarker.length)
      }
      else {
        if (!safeStorage.isEncryptionAvailable())
          throw new Error('系统凭据存储不可用')
        value = safeStorage.decryptString(bytes)
      }
      cache.set(name, value)
      return value
    },
    async write(name: string, value: string) {
      if (fileMode()) {
        await writeFile(join(dir, name), value ? `${plainMarker}${value}` : '', { mode: 0o600 })
      }
      else {
        if (!safeStorage.isEncryptionAvailable())
          throw new Error('系统凭据存储不可用，无法保存密钥')
        await writeFile(join(dir, name), value ? safeStorage.encryptString(value) : Buffer.alloc(0), { mode: 0o600 })
      }
      cache.set(name, value)
    },
  }
}
