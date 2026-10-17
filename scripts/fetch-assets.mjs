// Download the Live2D character assets that stay out of Git (see NOTICE.md) and verify every file.
//   pnpm assets
// The archive is published as a release asset; each extracted file is checked against docs/asset-inventory.json.
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const url = process.env.ANNA_ASSETS_URL ?? 'https://github.com/YuanyuanMa03/anna/releases/download/assets-v1/anna-character-assets.zip'
const archiveSha256 = '5520b11b621dcc9c9c7d1d9d1f87d4accdeb1bc58f74d25bd56f36fc54ea7bef'
const inventory = JSON.parse(await readFile(join(root, 'docs/asset-inventory.json'), 'utf8'))

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
async function mismatches() {
  const bad = []
  for (const entry of inventory) {
    const path = join(root, entry.path)
    if (!existsSync(path) || sha256(await readFile(path)) !== entry.sha256)
      bad.push(entry.path)
  }
  return bad
}

if ((await mismatches()).length === 0) {
  console.log(`Character assets are already in place (${inventory.length} files verified).`)
  process.exit(0)
}

console.log(`Downloading ${url}`)
const response = await fetch(url)
if (!response.ok)
  throw new Error(`Download failed: HTTP ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
if (sha256(bytes) !== archiveSha256)
  throw new Error('Checksum mismatch: the archive does not match the published assets')

const work = await mkdtemp(join(tmpdir(), 'anna-assets-'))
try {
  const archive = join(work, 'assets.zip')
  await writeFile(archive, bytes)
  // bsdtar reads zip on macOS and Windows; GNU tar on Linux does not.
  if (process.platform === 'linux')
    execFileSync('unzip', ['-oq', archive, '-d', root], { stdio: 'inherit' })
  else
    execFileSync('tar', ['-xf', archive, '-C', root], { stdio: 'inherit' })
}
finally {
  await rm(work, { recursive: true, force: true })
}

const bad = await mismatches()
if (bad.length > 0)
  throw new Error(`Asset checksum differs: ${bad.join(', ')}`)
console.log(`Character assets installed (${inventory.length} files verified).`)
