import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { createPackageWithOptions, extractFile, listPackage } from '@electron/asar'
import { describe, expect, it } from 'vitest'
import { stageDependencies } from '../scripts/stage-runtime.mjs'

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
      expect((await readdir(output)).sort()).toEqual(['.store', 'a', 'b'])
      const archive = join(root, 'fixture.asar')
      await createPackageWithOptions(join(root, 'runtime'), archive, {})
      expect(listPackage(archive, { isPack: false }).some(path => path.includes('typescript'))).toBe(false)
      expect(extractFile(archive, join('node_modules', 'a', 'index.cjs')).toString()).toBe('module.exports = require(\'shared\')')
      expect(await readFile(join(output, 'a/LICENSE'), 'utf8')).toContain('Synthetic fixture')
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
