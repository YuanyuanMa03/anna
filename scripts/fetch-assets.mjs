// Download the Live2D character assets that stay out of Git (see NOTICE.md) and verify every file.
//   pnpm assets
// The archives are published as release assets; each extracted file is checked against docs/asset-inventory.json.
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const releases = process.env.ANNA_ASSETS_BASE ?? 'https://github.com/YuanyuanMa03/anna/releases/download'
// v1: Hiyori, Haru, Mark and Cubism Core. v2: Mao, Natori and Chitose.
const archives = [
  { url: `${releases}/assets-v1/anna-character-assets.zip`, sha256: '5520b11b621dcc9c9c7d1d9d1f87d4accdeb1bc58f74d25bd56f36fc54ea7bef' },
  { url: `${releases}/assets-v2/anna-character-assets-v2.zip`, sha256: '56bd1ce1919123384b2884cb5e634f1d06b83b296f234ffc345e5573217b9644' },
]
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

const work = await mkdtemp(join(tmpdir(), 'anna-assets-'))
try {
  for (const { url, sha256: expected } of archives) {
    console.log(`Downloading ${url}`)
    const response = await fetch(url)
    if (!response.ok)
      throw new Error(`Download failed: HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (sha256(bytes) !== expected)
      throw new Error(`Checksum mismatch: ${url} does not match the published assets`)
    const archive = join(work, 'assets.zip')
    await writeFile(archive, bytes)
    // bsdtar reads zip on macOS and Windows; GNU tar on Linux does not.
    if (process.platform === 'linux')
      execFileSync('unzip', ['-oq', archive, '-d', root], { stdio: 'inherit' })
    else
      execFileSync('tar', ['-xf', archive, '-C', root], { stdio: 'inherit' })
  }
}
finally {
  await rm(work, { recursive: true, force: true })
}

const bad = await mismatches()
if (bad.length > 0)
  throw new Error(`Asset checksum differs: ${bad.join(', ')}`)
console.log(`Character assets installed (${inventory.length} files verified).`)
