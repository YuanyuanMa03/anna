import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { artifactName, artifactUrl, verifyArtifact } from '../scripts/electron-dist.mjs'

describe('electron for another platform', () => {
  it('names the exact artifact of the pinned version', () => {
    expect(artifactName('win32', 'x64', '44.7.0')).toBe('electron-v44.7.0-win32-x64.zip')
    expect(artifactName('linux', 'x64', '44.7.0')).toBe('electron-v44.7.0-linux-x64.zip')
  })

  it('downloads from the official release, or the mirror Electron itself honours', () => {
    expect(artifactUrl('electron-v1.0.0-win32-x64.zip', '1.0.0', {})).toBe('https://github.com/electron/electron/releases/download/v1.0.0/electron-v1.0.0-win32-x64.zip')
    expect(artifactUrl('electron-v1.0.0-win32-x64.zip', '1.0.0', { ELECTRON_MIRROR: 'https://mirror.test/electron/' })).toBe('https://mirror.test/electron/v1.0.0/electron-v1.0.0-win32-x64.zip')
  })

  it('follows Electron\'s own custom folder setting, as npm mirrors need', () => {
    expect(artifactUrl('a.zip', '1.0.0', { ELECTRON_MIRROR: 'https://mirror.test/', ELECTRON_CUSTOM_DIR: '{{ version }}' })).toBe('https://mirror.test/1.0.0/a.zip')
  })

  it('accepts only bytes matching the checksum published with the npm package', () => {
    const bytes = Buffer.from('electron')
    const sha = createHash('sha256').update(bytes).digest('hex')
    expect(() => verifyArtifact(bytes, 'a.zip', { 'a.zip': sha })).not.toThrow()
    expect(() => verifyArtifact(Buffer.from('tampered'), 'a.zip', { 'a.zip': sha })).toThrow('checksum')
    expect(() => verifyArtifact(bytes, 'a.zip', {})).toThrow('checksum')
  })
})
