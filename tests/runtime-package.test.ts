import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { createPackageWithOptions, extractFile, listPackage } from '@electron/asar'
import { describe, expect, it } from 'vitest'
import { longestPath, stageDependencies, unpackedFiles } from '../scripts/stage-runtime.mjs'

async function packageAt(path: string, name: string, value: string, dependencies = {}, peers = {}) {
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'package.json'), JSON.stringify({ name, main: 'index.cjs', dependencies, ...peers }))
  await writeFile(join(path, 'index.cjs'), value)
  await writeFile(join(path, 'LICENSE'), 'Synthetic fixture license, not a third-party asset')
}
async function link(source: string, target: string) {
  await mkdir(dirname(target), { recursive: true })
  await symlink(resolve(source), target, process.platform === 'win32' ? 'junction' : 'dir')
}

async function linksBelow(root: string) {
  const entries = await readdir(root, { withFileTypes: true, recursive: true })
  return entries.filter(entry => entry.isSymbolicLink()).map(entry => entry.name)
}

describe('production dependency staging', () => {
  it('preserves conflicting versions and shared identity while excluding optional development peers and external Electron', async () => {
    const root = await mkdtemp(join(tmpdir(), 'anna 精简 package '))
    try {
      const a = join(root, 'store/a/node_modules/a')
      const b = join(root, 'store/b/node_modules/b')
      const one = join(root, 'store/one/node_modules/shared')
      const two = join(root, 'store/two/node_modules/shared')
      const dev = join(root, 'node_modules/typescript')
      await packageAt(one, 'shared', 'module.exports = { version: 1 }')
      await packageAt(two, 'shared', 'module.exports = { version: 2 }')
      await packageAt(a, 'a', 'module.exports = require(\'shared\')', { shared: '1' }, { peerDependencies: { typescript: '*', electron: '*' }, peerDependenciesMeta: { typescript: { optional: true } } })
      await packageAt(b, 'b', 'module.exports = require(\'shared\')', { shared: '2' })
      await packageAt(dev, 'typescript', 'throw new Error(\'Must not ship\')')
      await link(one, join(dirname(a), 'shared'))
      await link(two, join(dirname(b), 'shared'))
      await link(a, join(root, 'node_modules/a'))
      await link(b, join(root, 'node_modules/b'))
      const output = join(root, 'runtime/node_modules')
      expect(await stageDependencies(root, output, ['a', 'b'])).toBe(4)
      const require = createRequire(join(root, 'runtime/package.json'))
      expect(require('a')).toEqual({ version: 1 })
      expect(require('b')).toEqual({ version: 2 })
      expect(require('a')).toBe(require('a'))
      expect((await readdir(output)).sort()).toEqual(['a', 'b', 'shared'])
      expect(await linksBelow(output)).toEqual([])
      const archive = join(root, 'fixture.asar')
      await createPackageWithOptions(join(root, 'runtime'), archive, {})
      expect(listPackage(archive, { isPack: false }).some(path => path.includes('typescript'))).toBe(false)
      expect(extractFile(archive, join('node_modules', 'a', 'index.cjs')).toString()).toBe('module.exports = require(\'shared\')')
      expect(extractFile(archive, join('node_modules', 'b', 'node_modules', 'shared', 'index.cjs')).toString()).toBe('module.exports = { version: 2 }')
      expect(await readFile(join(output, 'a/LICENSE'), 'utf8')).toContain('Synthetic fixture')
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })
  it('gives a package its own version before anything below it can be misled by the shared one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'anna 精简 order '))
    try {
      const top = join(root, 'store/top/node_modules/top')
      const mid = join(root, 'store/mid/node_modules/mid')
      const leaf = join(root, 'store/leaf/node_modules/leaf')
      const one = join(root, 'store/one/node_modules/x')
      const two = join(root, 'store/two/node_modules/x')
      await packageAt(one, 'x', 'module.exports = 1')
      await packageAt(two, 'x', 'module.exports = 2')
      await packageAt(top, 'top', 'module.exports = require(\'x\')', { x: '1' })
      await packageAt(leaf, 'leaf', 'module.exports = require(\'x\')', { x: '1' })
      await packageAt(mid, 'mid', 'module.exports = [require(\'x\'), require(\'leaf\')]', { leaf: '1', x: '2' })
      await link(one, join(dirname(top), 'x'))
      await link(one, join(dirname(leaf), 'x'))
      await link(two, join(dirname(mid), 'x'))
      await link(leaf, join(dirname(mid), 'leaf'))
      await link(top, join(root, 'node_modules/top'))
      await link(mid, join(root, 'node_modules/mid'))
      const output = join(root, 'runtime/node_modules')
      await stageDependencies(root, output, ['top', 'mid'])
      const require = createRequire(join(root, 'runtime/package.json'))
      expect(require('top')).toBe(1)
      expect(require('mid')).toEqual([2, 1])
      expect(await linksBelow(output)).toEqual([])
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })

  it('survives dependency cycles and leaves out the agent SDK\'s native binaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'anna-cycle-'))
    try {
      const a = join(root, 'store/a/node_modules/a')
      const b = join(root, 'store/b/node_modules/b')
      const binary = join(root, 'store/bin/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64')
      await packageAt(a, 'a', 'module.exports = 1', { b: '1' }, { optionalDependencies: { '@anthropic-ai/claude-agent-sdk-win32-x64': '1' } })
      await packageAt(b, 'b', 'module.exports = 2', { a: '1' })
      await packageAt(binary, '@anthropic-ai/claude-agent-sdk-win32-x64', 'throw new Error(\'Must not ship\')')
      await link(b, join(dirname(a), 'b'))
      await link(a, join(dirname(b), 'a'))
      await mkdir(join(dirname(a), '@anthropic-ai'), { recursive: true })
      await link(binary, join(dirname(a), '@anthropic-ai/claude-agent-sdk-win32-x64'))
      await link(a, join(root, 'node_modules/a'))
      const output = join(root, 'runtime/node_modules')
      expect(await stageDependencies(root, output, ['a'])).toBe(2)
      expect(existsSync(join(output, '@anthropic-ai'))).toBe(false)
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })

  it('unpacks native files from a stage below a dot folder, and leaves scripts in the archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'anna unpack '))
    try {
      const stage = join(root, '.data/runtime-stage')
      await packageAt(join(stage, 'node_modules/native'), 'native', 'module.exports = 1')
      await writeFile(join(stage, 'node_modules/native/addon.node'), 'binary')
      const archive = join(root, 'app.asar')
      await createPackageWithOptions(stage, archive, { unpack: unpackedFiles })
      expect(existsSync(join(`${archive}.unpacked`, 'node_modules/native/addon.node'))).toBe(true)
      expect(existsSync(join(`${archive}.unpacked`, 'node_modules/native/index.cjs'))).toBe(false)
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })

  it('measures the longest path below a folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'anna-longest-'))
    try {
      await packageAt(join(root, 'a/b'), 'x', 'module.exports = 1')
      expect(await longestPath(root)).toBe(join('a', 'b', 'package.json').length)
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })

  it('fails for a missing required runtime dependency', async () => {
    const root = await mkdtemp(join(tmpdir(), 'anna-missing-runtime-'))
    try {
      await expect(stageDependencies(root, join(root, 'out'), ['missing-anna-runtime-fixture'])).rejects.toThrow('Missing runtime dependency')
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })
})

describe('windows installer', () => {
  it('removes an old install completely before writing, and stops when it cannot', async () => {
    const script = await readFile('scripts/windows-installer.nsi', 'utf8')
    const section = script.slice(script.indexOf('Section "Anna"'), script.indexOf('File /r'))
    expect(section).toMatch(/rd \/s \/q "\\\\\?\\\$\{APPDIR\}"/)
    expect(section).toMatch(/IfFileExists[\s\S]*Abort/)
    expect(await readFile('scripts/package-windows-installer.mjs', 'utf8')).toContain('\'-INPUTCHARSET\', \'UTF8\'')
  })
})
