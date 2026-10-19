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
    // The download's own folder (the archive, the script itself) is gone once the new version is in place.
    const work = join(root, 'staged')
    await writeFile(join(work, 'update.archive'), 'bytes')
    const script = swapScript(process.platform, { pid: 999999, current, staged, relaunch: `touch ${JSON.stringify(marker)}`, work })
    await writeFile(join(work, 'swap.sh'), script, { mode: 0o700 })
    await promisify(execFile)('/bin/sh', [join(work, 'swap.sh')])
    expect(await readFile(join(current, 'version'), 'utf8')).toBe('new')
    expect(existsSync(`${current}.old`)).toBe(false)
    expect(existsSync(marker)).toBe(true)
    expect(existsSync(work)).toBe(false)
  })
})

describe('signed release manifests', () => {
  it('only a manifest signed with the release key is trusted; any change to it breaks the signature', async () => {
    const { generateKeyPairSync, sign } = await import('node:crypto')
    const { manifestPayload, verifyManifest, releasePublicKey } = await import('../packages/shared/update')
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
    const signed = { ...manifest, signature: sign(null, Buffer.from(manifestPayload(manifest)), privateKey).toString('base64') }
    expect(verifyManifest(signed, key)).toBe(true)
    expect(verifyManifest(signed, releasePublicKey)).toBe(false)
    expect(verifyManifest(manifest, key)).toBe(false)
    expect(verifyManifest({ ...signed, version: '9.9.9' }, key)).toBe(false)
    expect(verifyManifest({ ...signed, assets: { ...signed.assets, 'darwin-arm64': { ...signed.assets['darwin-arm64'], url: 'https://evil.example/a.zip' } } }, key)).toBe(false)
    expect(verifyManifest({ ...signed, notes: 'changed' }, key)).toBe(false)
    expect(verifyManifest({ ...signed, signature: 'not base64 at all' }, key)).toBe(false)
  })

  it('scripts/sign-manifest.mjs signs what the app verifies, keeping one asset per line for install.sh', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { mkdtemp, readFile, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { execFileSync } = await import('node:child_process')
    const { verifyManifest } = await import('../packages/shared/update')
    const dir = await mkdtemp(join(tmpdir(), 'anna-sign-'))
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    await writeFile(join(dir, 'key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }))
    await writeFile(join(dir, 'latest.json'), JSON.stringify(manifest))
    execFileSync(process.execPath, ['scripts/sign-manifest.mjs', join(dir, 'latest.json')], { env: { ...process.env, ANNA_RELEASE_SIGNING_KEY: join(dir, 'key.pem') } })
    const text = await readFile(join(dir, 'latest.json'), 'utf8')
    expect(verifyManifest(JSON.parse(text), publicKey.export({ type: 'spki', format: 'der' }).toString('base64'))).toBe(true)
    expect(text.split('\n').filter(line => line.includes('"sha256"'))).toHaveLength(2)
    expect(text).toMatch(/^ {2}"version": "0\.5\.0",$/m)
  })

  it('quotes paths for the shell that runs them', async () => {
    const { sh, ps } = await import('../packages/shared/update')
    expect(sh('/Applications/O\'Brien $HOME `x`.app')).toBe('\'/Applications/O\'\\\'\'Brien $HOME `x`.app\'')
    expect(ps('C:\\Users\\O\'Brien\\Anna.exe')).toBe('\'C:\\Users\\O\'\'Brien\\Anna.exe\'')
  })
})
