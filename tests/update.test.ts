import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { compareVersions, planUpdate, verifyDigest } from '../packages/shared/update'

const manifest = {
  version: '0.5.0',
  notes: '外部 agent 与一行安装',
  assets: {
    'darwin-arm64': { url: 'https://github.com/x/releases/download/v0.5.0/Anna-0.5.0-mac-arm64.zip', sha256: 'a'.repeat(64) },
    'win32-x64': { url: 'https://github.com/x/releases/download/v0.5.0/Anna-0.5.0-windows-x64.zip', sha256: 'b'.repeat(64) },
  },
}

describe('updates', () => {
  it('compares versions numerically, with pre-releases before releases', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.4.0', '0.4.0')).toBe(0)
    expect(compareVersions('0.5.0-beta.1', '0.5.0')).toBeLessThan(0)
  })
  it('offers the asset for this platform only when it is newer', () => {
    expect(planUpdate(manifest, '0.4.0', 'darwin', 'arm64')).toEqual({ available: true, version: '0.5.0', notes: '外部 agent 与一行安装', url: manifest.assets['darwin-arm64'].url, sha256: 'a'.repeat(64) })
    expect(planUpdate(manifest, '0.5.0', 'darwin', 'arm64')).toEqual({ available: false, version: '0.5.0' })
    expect(planUpdate(manifest, '0.4.0', 'linux', 'x64')).toEqual({ available: false, version: '0.5.0', reason: '这个版本还没有 linux-x64 的安装包' })
  })
  it('rejects manifests that are not https or malformed checksums', () => {
    expect(() => planUpdate({ ...manifest, assets: { 'darwin-arm64': { url: 'http://evil.example/a.zip', sha256: 'a'.repeat(64) } } }, '0.4.0', 'darwin', 'arm64')).toThrow(/HTTPS/)
    expect(() => planUpdate({ ...manifest, assets: { 'darwin-arm64': { url: 'https://x/a.zip', sha256: 'nope' } } }, '0.4.0', 'darwin', 'arm64')).toThrow(/校验值/)
  })
  it('verifies the downloaded bytes against the manifest checksum', () => {
    const bytes = Buffer.from('anna')
    expect(verifyDigest(bytes, createHash('sha256').update(bytes).digest('hex'))).toBe(true)
    expect(verifyDigest(bytes, 'f'.repeat(64))).toBe(false)
  })
})

describe('swap script', () => {
  it.skipIf(process.platform === 'win32')('waits for Anna to exit, swaps the bundle in, keeps nothing stale, and relaunches', async () => {
    const { mkdtemp, mkdir, writeFile, readFile } = await import('node:fs/promises')
    const { existsSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const { swapScript } = await import('../packages/shared/update')
    const root = await mkdtemp(join(tmpdir(), 'anna-swap-'))
    const current = join(root, 'Applications', 'Anna.app')
    const staged = join(root, 'staged', 'Anna.app')
    await mkdir(current, { recursive: true })
    await mkdir(staged, { recursive: true })
    await writeFile(join(current, 'version'), 'old')
    await writeFile(join(staged, 'version'), 'new')
    const marker = join(root, 'relaunched')
    const script = swapScript(process.platform, { pid: 999999, current, staged, relaunch: `touch ${JSON.stringify(marker)}` })
    await writeFile(join(root, 'swap.sh'), script, { mode: 0o700 })
    await promisify(execFile)('/bin/sh', [join(root, 'swap.sh')])
    expect(await readFile(join(current, 'version'), 'utf8')).toBe('new')
    expect(existsSync(`${current}.old`)).toBe(false)
    expect(existsSync(marker)).toBe(true)
  })
})
