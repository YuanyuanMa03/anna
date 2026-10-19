// Download the Live2D character assets that stay out of Git (see NOTICE.md) and verify every file.
//   pnpm assets
// The archives are published as release assets; each extracted file is checked against docs/asset-inventory.json.
// The repository is private, so its release assets need a GitHub token in GH_TOKEN or GITHUB_TOKEN:
//   GH_TOKEN=$(gh auth token) pnpm assets
// ANNA_ASSETS_BASE points at a mirror laid out like the release downloads (<base>/<tag>/<file>); it never gets the token.
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const repo = 'YuanyuanMa03/anna'
const mirror = process.env.ANNA_ASSETS_BASE
// Same precedence as the gh CLI. An empty value (an unset secret in CI) counts as no token.
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
// v1: Haru, Mark and Cubism Core (plus Hiyori, who left the cast). v2: Mao, Natori and Chitose.
const archives = [
  { tag: 'assets-v1', name: 'anna-character-assets.zip', sha256: '5520b11b621dcc9c9c7d1d9d1f87d4accdeb1bc58f74d25bd56f36fc54ea7bef' },
  { tag: 'assets-v2', name: 'anna-character-assets-v2.zip', sha256: '56bd1ce1919123384b2884cb5e634f1d06b83b296f234ffc345e5573217b9644' },
]
const inventory = JSON.parse(await readFile(join(root, 'docs/asset-inventory.json'), 'utf8'))
// The v1 archive still carries Hiyori. Everything under assets/ ships with the app and the website, so she must not stay.
const retired = [join(root, 'assets/characters/hiyori'), join(root, 'assets/licenses/Hiyori-ReadMe.txt')]
const retire = () => Promise.all(retired.map(path => rm(path, { recursive: true, force: true })))

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

// Through the REST API: look the release up by tag, then ask for the asset's bytes. That request redirects to a signed
// storage URL, which is followed without the token so the token is only ever sent to api.github.com.
async function fromApi({ tag, name }) {
  const headers = { 'Authorization': `Bearer ${token}`, 'User-Agent': 'anna-fetch-assets', 'X-GitHub-Api-Version': '2022-11-28' }
  const release = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { headers: { ...headers, Accept: 'application/vnd.github+json' } })
  if (release.status === 401)
    throw new Error(`GitHub rejected the token in GH_TOKEN/GITHUB_TOKEN (HTTP 401). Refresh it, e.g. GH_TOKEN=$(gh auth token) pnpm assets`)
  if (release.status === 404)
    throw new Error(`Release ${tag} of ${repo} was not found (HTTP 404): it is missing, or the token in GH_TOKEN/GITHUB_TOKEN cannot read the repository`)
  if (!release.ok)
    throw new Error(`Looking up release ${tag} of ${repo} failed: HTTP ${release.status}`)
  const asset = (await release.json()).assets.find(asset => asset.name === name)
  if (!asset)
    throw new Error(`Release ${tag} of ${repo} has no asset named ${name}`)
  const response = await fetch(asset.url, { headers: { ...headers, Accept: 'application/octet-stream' }, redirect: 'manual' })
  const location = response.headers.get('location')
  if (response.status < 300 || response.status >= 400 || !location)
    return response
  await response.body?.cancel()
  return fetch(new URL(location, asset.url))
}

async function download(archive) {
  if (mirror) {
    const url = `${mirror}/${archive.tag}/${archive.name}`
    console.log(`Downloading ${url}`)
    return fetch(url)
  }
  if (token) {
    console.log(`Downloading ${archive.name} from release ${archive.tag} of ${repo} (GitHub API, token from the environment)`)
    return fromApi(archive)
  }
  const url = `https://github.com/${repo}/releases/download/${archive.tag}/${archive.name}`
  console.log(`Downloading ${url}`)
  const response = await fetch(url)
  if (response.status === 404)
    throw new Error(`Download failed: HTTP 404. ${repo} is private, so its release assets need a GitHub token: set GH_TOKEN or GITHUB_TOKEN, e.g. GH_TOKEN=$(gh auth token) pnpm assets`)
  return response
}

await retire()
if ((await mismatches()).length === 0) {
  console.log(`Character assets are already in place (${inventory.length} files verified).`)
  process.exit(0)
}

const work = await mkdtemp(join(tmpdir(), 'anna-assets-'))
try {
  for (const archive of archives) {
    const response = await download(archive)
    if (!response.ok)
      throw new Error(`Download failed: HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (sha256(bytes) !== archive.sha256)
      throw new Error(`Checksum mismatch: ${archive.name} does not match the published assets`)
    const path = join(work, 'assets.zip')
    await writeFile(path, bytes)
    // bsdtar reads zip on macOS and Windows; GNU tar on Linux does not.
    if (process.platform === 'linux')
      execFileSync('unzip', ['-oq', path, '-d', root], { stdio: 'inherit' })
    else
      execFileSync('tar', ['-xf', path, '-C', root], { stdio: 'inherit' })
  }
}
finally {
  await rm(work, { recursive: true, force: true })
  await retire()
}

const bad = await mismatches()
if (bad.length > 0)
  throw new Error(`Asset checksum differs: ${bad.join(', ')}`)
console.log(`Character assets installed (${inventory.length} files verified).`)
