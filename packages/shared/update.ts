import { Buffer } from 'node:buffer'
import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto'

/** The release manifest published as https://anna.mayuanyuan.top/latest.json (see scripts/release-manifest.mjs). */
export interface ReleaseManifest {
  version: string
  notes?: string
  /** Keyed by `${platform}-${arch}`, e.g. darwin-arm64, win32-x64, linux-x64. */
  assets: Record<string, { url: string, sha256: string }>
  /** Ed25519 signature of `manifestPayload` with the release key (scripts/sign-manifest.mjs). */
  signature?: string
}

/**
 * The release key's public half (SPKI, base64; scripts/release-keygen.mjs). The website only carries the manifest:
 * an update is installed only when the release machine signed it, so a changed website can't push code.
 */
export const releasePublicKey = 'MCowBQYDK2VwAyEAk69bdR8Cj6bbDY2zfDBzpCyCidyLQb6H3bGz+903alY='

/** The bytes the signature covers; must match scripts/manifest-payload.mjs. */
export function manifestPayload(manifest: ReleaseManifest) {
  const assets = Object.fromEntries(Object.keys(manifest.assets).sort().map(name => [name, { url: manifest.assets[name]!.url, sha256: manifest.assets[name]!.sha256.toLowerCase() }]))
  return JSON.stringify({ version: manifest.version, notes: manifest.notes ?? '', assets })
}

/** Whether the manifest carries a valid signature by the release key. */
export function verifyManifest(manifest: ReleaseManifest, publicKey = releasePublicKey) {
  if (typeof manifest?.signature !== 'string' || !manifest.assets || typeof manifest.version !== 'string')
    return false
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' })
    return verify(null, Buffer.from(manifestPayload(manifest)), key, Buffer.from(manifest.signature, 'base64'))
  }
  catch { return false }
}
export type UpdatePlan = { available: true, version: string, notes?: string, url: string, sha256: string } | { available: false, version: string, reason?: string }

/** Semantic version comparison; a pre-release sorts before its release. */
export function compareVersions(a: string, b: string) {
  const parse = (value: string) => {
    const [core, pre] = value.replace(/^v/, '').split('-', 2) as [string, string | undefined]
    return { parts: core.split('.').map(part => Number.parseInt(part, 10) || 0), pre }
  }
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < 3; index++) {
    const difference = (left.parts[index] ?? 0) - (right.parts[index] ?? 0)
    if (difference)
      return difference
  }
  if (left.pre === right.pre)
    return 0
  if (!left.pre)
    return 1
  if (!right.pre)
    return -1
  return left.pre.localeCompare(right.pre, undefined, { numeric: true })
}

export function planUpdate(manifest: ReleaseManifest, current: string, platform: string, arch: string): UpdatePlan {
  if (compareVersions(manifest.version, current) <= 0)
    return { available: false, version: manifest.version }
  const key = `${platform}-${arch}`
  const asset = manifest.assets[key]
  if (!asset)
    return { available: false, version: manifest.version, reason: `这个版本还没有 ${key} 的安装包` }
  if (!asset.url.startsWith('https://'))
    throw new Error('更新地址必须是 HTTPS')
  if (!/^[a-f0-9]{64}$/i.test(asset.sha256))
    throw new Error('更新包的校验值格式不正确')
  return { available: true, version: manifest.version, notes: manifest.notes, url: asset.url, sha256: asset.sha256.toLowerCase() }
}

export function verifyDigest(bytes: Uint8Array, sha256: string) {
  const actual = createHash('sha256').update(bytes).digest()
  const expected = Buffer.from(sha256, 'hex')
  return expected.length === actual.length && timingSafeEqual(actual, expected)
}

/** A value as one single-quoted word for sh / PowerShell, whatever characters the path holds. */
export const sh = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
export const ps = (value: string) => `'${value.replace(/'/g, `''`)}'`

/**
 * A detached script that finishes an update after Anna quits: wait for the old process, move the old app aside,
 * move the verified staged app into place, clear quarantine on macOS, then relaunch. On failure the old app is put back.
 */
/** `work`: the download's own temporary folder (the archive, this script), removed once the new version is in place. */
export function swapScript(platform: NodeJS.Platform, options: { pid: number, current: string, staged: string, relaunch: string, work?: string }) {
  const { pid, current, staged, relaunch, work } = options
  if (platform === 'win32') {
    return [
      `$ErrorActionPreference = 'Stop'`,
      `try { Wait-Process -Id ${pid} -Timeout 60 } catch {}`,
      `$current = ${ps(current)}; $staged = ${ps(staged)}; $old = "$current.old"`,
      `if (Test-Path $old) { Remove-Item -Recurse -Force $old }`,
      `Move-Item $current $old`,
      `try { Move-Item $staged $current; Remove-Item -Recurse -Force $old } catch { if (Test-Path $old) { Move-Item $old $current } }`,
      relaunch,
      ...(work ? [`Remove-Item -Recurse -Force ${ps(work)} -ErrorAction SilentlyContinue`] : []),
    ].join('\r\n')
  }
  return [
    '#!/bin/sh',
    `while kill -0 ${pid} 2>/dev/null; do sleep 0.3; done`,
    `CURRENT=${sh(current)}`,
    `STAGED=${sh(staged)}`,
    'rm -rf "$CURRENT.old"',
    'mv "$CURRENT" "$CURRENT.old" || exit 1',
    'if mv "$STAGED" "$CURRENT"; then rm -rf "$CURRENT.old"; else mv "$CURRENT.old" "$CURRENT"; fi',
    ...(platform === 'darwin' ? ['/usr/bin/xattr -dr com.apple.quarantine "$CURRENT" >/dev/null 2>&1 || true'] : []),
    relaunch,
    ...(work ? [`rm -rf ${sh(work)}`] : []),
    '',
  ].join('\n')
}
