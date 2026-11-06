import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)

export const artifactName = (platform, arch, version) => `electron-v${version}-${platform}-${arch}.zip`

export function artifactUrl(name, version, env = process.env) {
  const base = (env.ELECTRON_MIRROR || 'https://github.com/electron/electron/releases/download/').replace(/\/?$/, '/')
  const folder = (env.ELECTRON_CUSTOM_DIR || 'v{{ version }}').replace('{{ version }}', version)
  return `${base}${folder}/${name}`
}

/** The npm package pins a checksum for every artifact, so a download is held to the version in the lockfile. */
export function verifyArtifact(bytes, name, checksums) {
  const expected = checksums[name]
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (!expected || actual !== expected)
    throw new Error(`${name} failed its checksum: expected ${expected ?? 'a published value'}, got ${actual}`)
}

/** Windows' own bsdtar: a Git Bash tar earlier on the path reads `C:\\…` as a remote host and cannot open zips. */
export function systemTar() {
  return process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
}

/** Unpacks a .zip with the tool each system has. */
export function unzip(archive, destination) {
  if (process.platform === 'win32')
    execFileSync(systemTar(), ['-xf', archive, '-C', destination], { stdio: 'inherit' })
  else
    execFileSync('unzip', ['-q', archive, '-d', destination], { stdio: 'inherit' })
}

/** Electron for any target, so that every package can be built on any machine. Returns the unpacked folder, cached. */
export async function electronDist(platform, arch) {
  const { version } = require('electron/package.json')
  const name = artifactName(platform, arch, version)
  const cache = resolve('.data/electron-dist')
  const folder = join(cache, name.replace(/\.zip$/, ''))
  if (existsSync(join(folder, 'version')))
    return folder
  await mkdir(cache, { recursive: true })
  process.stdout.write(`Downloading ${name}\n`)
  // A stalled connection must fail the build, not hang it. About 100 MB, so allow a slow line.
  const response = await fetch(artifactUrl(name, version), { redirect: 'follow', signal: AbortSignal.timeout(15 * 60_000) })
  if (!response.ok)
    throw new Error(`Downloading ${name} failed: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  verifyArtifact(bytes, name, require('electron/checksums.json'))
  const work = await mkdtemp(join(cache, 'download-'))
  try {
    const archive = join(work, name)
    await writeFile(archive, bytes)
    const unpacked = join(work, 'unpacked')
    await mkdir(unpacked)
    unzip(archive, unpacked)
    await rm(folder, { recursive: true, force: true })
    await rename(unpacked, folder)
  }
  finally { await rm(work, { recursive: true, force: true }) }
  return folder
}

/** A .zip of `folder` inside `parent`, with the tool each system has. */
export function zipFolder(parent, folder, output) {
  if (process.platform === 'win32')
    execFileSync(systemTar(), ['-a', '-cf', output, '-C', parent, folder], { stdio: 'inherit' })
  else
    execFileSync('zip', ['-qry', '-X', output, folder], { cwd: parent, stdio: 'inherit' })
}

export const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex')
