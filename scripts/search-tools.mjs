import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { systemTar, unzip } from './electron-dist.mjs'

const ripgrep = '15.2.0'
const fd = '10.5.1'
const release = (repo, tag, name) => `https://github.com/${repo}/releases/download/${tag}/${name}`

/** Checksums are the SHA-256 digests GitHub publishes for each release asset. */
const pinned = {
  'win32-x64': [
    { tool: 'rg', name: `ripgrep-${ripgrep}-x86_64-pc-windows-msvc.zip`, sha256: '71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5' },
    { tool: 'fd', name: `fd-v${fd}-x86_64-pc-windows-msvc.zip`, sha256: 'e52306a600e60b7ba92019c81dc753e6ea6665379d005867d38215ffd14cf5c2' },
  ],
  'linux-x64': [
    { tool: 'rg', name: `ripgrep-${ripgrep}-x86_64-unknown-linux-musl.tar.gz`, sha256: '33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c' },
    { tool: 'fd', name: `fd-v${fd}-x86_64-unknown-linux-musl.tar.gz`, sha256: 'f6c95edb190c241df6fddc815a5bab4051444993ac5d92ddc6eec0e0dc2342c7' },
  ],
  'darwin-arm64': [
    { tool: 'rg', name: `ripgrep-${ripgrep}-aarch64-apple-darwin.tar.gz`, sha256: '3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4' },
    { tool: 'fd', name: `fd-v${fd}-aarch64-apple-darwin.tar.gz`, sha256: '2d336895ed27b14c5cc9fc5eb22df03b3ee842b5dce80060e99d9cdc1b1b9fc7' },
  ],
}

/** ripgrep and fd for one target, pinned by version and checksum. */
export function searchToolAssets(platform, arch) {
  const assets = pinned[`${platform}-${arch}`]
  if (!assets)
    throw new Error(`No pinned search tools for ${platform}-${arch}`)
  return assets.map(asset => ({ ...asset, url: asset.tool === 'rg' ? release('BurntSushi/ripgrep', ripgrep, asset.name) : release('sharkdp/fd', `v${fd}`, asset.name) }))
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex')

/** The verified bytes themselves, so nothing can change the cached file between checking and unpacking it. */
async function verifiedArchive(asset, cache, request) {
  const path = join(cache, asset.name)
  const cached = await readFile(path).catch(() => undefined)
  if (cached && digest(cached) === asset.sha256)
    return cached
  process.stdout.write(`Downloading ${asset.name}\n`)
  const response = await request(asset.url, { redirect: 'follow', signal: AbortSignal.timeout(5 * 60_000) })
  if (!response.ok)
    throw new Error(`Downloading ${asset.name} failed: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const actual = digest(bytes)
  if (actual !== asset.sha256) {
    await rm(path, { force: true })
    throw new Error(`${asset.name} failed its checksum: expected ${asset.sha256}, got ${actual}`)
  }
  await mkdir(cache, { recursive: true })
  await writeFile(`${path}.partial`, bytes)
  await rename(`${path}.partial`, path)
  return bytes
}

async function find(directory, name) {
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name === name)
      return join(entry.parentPath, entry.name)
  }
}

/**
 * Puts ripgrep and fd into `resources/bin`, where the packaged app adds them to the agent's path. Only the executables
 * are copied, not their manuals or shell completions.
 */
export async function stageSearchTools(resources, platform, options) {
  const assets = options.assets ?? searchToolAssets(platform, options.arch)
  const cache = options.cache ?? resolve('.data/search-tools')
  const request = options.request ?? fetch
  const bin = join(resources, 'bin')
  await rm(bin, { recursive: true, force: true })
  await mkdir(bin, { recursive: true })
  await mkdir(cache, { recursive: true })
  const staged = []
  for (const asset of assets) {
    const bytes = await verifiedArchive(asset, cache, request)
    const name = platform === 'win32' ? `${asset.tool}.exe` : asset.tool
    const work = await mkdtemp(join(cache, 'extract-'))
    try {
      const archive = join(work, asset.name)
      await writeFile(archive, bytes)
      const unpacked = join(work, 'unpacked')
      await mkdir(unpacked)
      if (asset.name.endsWith('.zip'))
        unzip(archive, unpacked)
      else
        execFileSync(systemTar(), ['-xzf', archive, '-C', unpacked], { stdio: 'inherit' })
      const binary = await find(unpacked, name)
      if (!binary)
        throw new Error(`${asset.name} has no ${name}`)
      await copyFile(binary, join(bin, name))
      await chmod(join(bin, name), 0o755)
    }
    finally { await rm(work, { recursive: true, force: true }) }
    staged.push(asset.tool)
  }
  return staged
}
