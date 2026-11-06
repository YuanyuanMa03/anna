import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, constants, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { packagedCoreEnv, withSearchTools } from '../packages/shared/search-path'
import { systemTar, zipFolder } from '../scripts/electron-dist.mjs'
import { searchToolAssets, stageSearchTools } from '../scripts/search-tools.mjs'

describe('search tools on the agent\'s path', () => {
  it('puts the bundled folder first on Windows, in the variable Windows already has, without a second copy', () => {
    const env = withSearchTools({ Path: 'C:\\Windows\\System32', HOME: 'x' }, 'C:\\Anna\\resources\\bin', 'win32')
    expect(env).toEqual({ Path: 'C:\\Anna\\resources\\bin;C:\\Windows\\System32', HOME: 'x' })
  })

  it('folds duplicate spellings into one on Windows so the child cannot pick the stale one', () => {
    const env = withSearchTools({ PATH: 'C:\\a', Path: 'C:\\b' }, 'C:\\bin', 'win32')
    expect(Object.keys(env).filter(key => key.toUpperCase() === 'PATH')).toHaveLength(1)
    expect(Object.values(env)[0]).toMatch(/^C:\\bin;/)
  })

  it('uses a colon elsewhere, and works when there is no path at all', () => {
    expect(withSearchTools({ PATH: '/usr/bin' }, '/opt/Anna/resources/bin', 'linux').PATH).toBe('/opt/Anna/resources/bin:/usr/bin')
    expect(withSearchTools({}, '/bin-dir', 'darwin').PATH).toBe('/bin-dir')
  })
})

describe('the packaged core', () => {
  it('finds the bundled tools and never lets the agent download any', () => {
    const env = packagedCoreEnv({ PATH: '/usr/bin' }, '/opt/Anna/resources', 'linux')
    expect(env.PATH).toBe(`${join('/opt/Anna/resources', 'bin')}:/usr/bin`)
    expect(env.PI_OFFLINE).toBe('1')
  })
})

describe('pinned search tool downloads', () => {
  it('pins ripgrep and fd for every target, from their official releases, by checksum', () => {
    for (const [platform, arch] of [['win32', 'x64'], ['linux', 'x64'], ['darwin', 'arm64']]) {
      const assets = searchToolAssets(platform, arch)
      expect(assets.map(asset => asset.tool).sort()).toEqual(['fd', 'rg'])
      for (const asset of assets) {
        expect(asset.url).toMatch(/^https:\/\/github\.com\/(?:BurntSushi\/ripgrep|sharkdp\/fd)\/releases\/download\//)
        expect(asset.url.endsWith(asset.name)).toBe(true)
        expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/)
      }
    }
    expect(() => searchToolAssets('linux', 'arm64')).toThrow()
  })
})

describe('staging the search tools', () => {
  const roots: string[] = []
  afterEach(async () => {
    for (const root of roots.splice(0))
      await rm(root, { recursive: true, force: true })
  })

  async function archive(kind: 'zip' | 'tar.gz', binary: string, contents: string) {
    const root = await mkdtemp(join(tmpdir(), 'anna 搜索 tools '))
    roots.push(root)
    const folder = `tool-1.0.0-${kind}`
    await mkdir(join(root, folder))
    await writeFile(join(root, folder, binary), contents, { mode: 0o644 })
    await writeFile(join(root, folder, 'README.md'), 'not shipped')
    const name = `${folder}.${kind}`
    if (kind === 'zip')
      zipFolder(root, folder, join(root, name))
    else
      execFileSync(systemTar(), ['-czf', join(root, name), '-C', root, folder])
    const bytes = new Uint8Array(await readFile(join(root, name)))
    return { root, name, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
  }

  function serve(files: Record<string, Uint8Array<ArrayBuffer>>) {
    const requested: string[] = []
    const request = async (url: string | URL | Request) => {
      requested.push(String(url))
      const bytes = files[String(url)]
      return bytes ? new Response(bytes) : new Response('missing', { status: 404 })
    }
    return { request: request as typeof fetch, requested }
  }

  it('unpacks only the executables into resources/bin, runnable, and reuses the verified cache', async () => {
    const rg = await archive('tar.gz', 'rg', 'rg-binary')
    const fd = await archive('zip', 'fd', 'fd-binary')
    const assets = [
      { tool: 'rg', name: rg.name, url: `https://example.test/${rg.name}`, sha256: rg.sha256 },
      { tool: 'fd', name: fd.name, url: `https://example.test/${fd.name}`, sha256: fd.sha256 },
    ]
    const { request, requested } = serve({ [assets[0].url]: rg.bytes, [assets[1].url]: fd.bytes })
    const resources = join(rg.root, 'resources')
    const cache = join(rg.root, 'cache')
    const staged = await stageSearchTools(resources, 'linux', { arch: 'x64', assets, cache, request })
    expect(staged.sort()).toEqual(['fd', 'rg'])
    expect(await readFile(join(resources, 'bin', 'rg'), 'utf8')).toBe('rg-binary')
    expect(await readFile(join(resources, 'bin', 'fd'), 'utf8')).toBe('fd-binary')
    if (process.platform !== 'win32')
      await access(join(resources, 'bin', 'rg'), constants.X_OK)
    await stageSearchTools(join(rg.root, 'again'), 'linux', { arch: 'x64', assets, cache, request })
    expect(requested).toHaveLength(2)
  })

  it('names Windows executables with .exe', async () => {
    const rg = await archive('zip', 'rg.exe', 'rg-windows')
    const assets = [{ tool: 'rg', name: rg.name, url: `https://example.test/${rg.name}`, sha256: rg.sha256 }]
    const { request } = serve({ [assets[0].url]: rg.bytes })
    await stageSearchTools(join(rg.root, 'resources'), 'win32', { arch: 'x64', assets, cache: join(rg.root, 'cache'), request })
    expect(await readFile(join(rg.root, 'resources', 'bin', 'rg.exe'), 'utf8')).toBe('rg-windows')
  })

  it('refuses a download whose checksum differs, and leaves nothing behind to be trusted later', async () => {
    const rg = await archive('tar.gz', 'rg', 'rg-binary')
    const assets = [{ tool: 'rg', name: rg.name, url: `https://example.test/${rg.name}`, sha256: '0'.repeat(64) }]
    const { request } = serve({ [assets[0].url]: rg.bytes })
    const cache = join(rg.root, 'cache')
    await expect(stageSearchTools(join(rg.root, 'resources'), 'linux', { arch: 'x64', assets, cache, request })).rejects.toThrow('checksum')
    await expect(access(join(cache, rg.name))).rejects.toThrow()
  })

  it('rejects a tampered cache instead of shipping it', async () => {
    const rg = await archive('tar.gz', 'rg', 'rg-binary')
    const assets = [{ tool: 'rg', name: rg.name, url: `https://example.test/${rg.name}`, sha256: rg.sha256 }]
    const cache = join(rg.root, 'cache')
    await mkdir(cache, { recursive: true })
    await writeFile(join(cache, rg.name), 'tampered')
    const { request, requested } = serve({ [assets[0].url]: rg.bytes })
    await stageSearchTools(join(rg.root, 'resources'), 'linux', { arch: 'x64', assets, cache, request })
    expect(requested).toHaveLength(1)
    expect(await readFile(join(rg.root, 'resources', 'bin', 'rg'), 'utf8')).toBe('rg-binary')
  })

  it('fails when the archive has no such executable', async () => {
    const rg = await archive('tar.gz', 'other', 'x')
    const assets = [{ tool: 'rg', name: rg.name, url: `https://example.test/${rg.name}`, sha256: rg.sha256 }]
    const { request } = serve({ [assets[0].url]: rg.bytes })
    await expect(stageSearchTools(join(rg.root, 'resources'), 'linux', { arch: 'x64', assets, cache: join(rg.root, 'cache'), request })).rejects.toThrow('rg')
  })
})
