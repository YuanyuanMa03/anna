import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { createPackageWithOptions } from '@electron/asar'
import { describe, expect, it } from 'vitest'
import { binaryKind, checkPackage } from '../scripts/verify-package.mjs'

function pe(machine: number) {
  const bytes = Buffer.alloc(256)
  bytes.write('MZ')
  bytes.writeUInt32LE(0x80, 0x3C)
  bytes.write('PE\0\0', 0x80, 'latin1')
  bytes.writeUInt16LE(machine, 0x84)
  return bytes
}
function elf(machine: number) {
  const bytes = Buffer.alloc(64)
  bytes.write('\x7FELF', 0, 'latin1')
  bytes[4] = 2
  bytes.writeUInt16LE(machine, 18)
  return bytes
}

async function fixture(options: { machine?: number, version?: string, skipDependency?: boolean, leftover?: boolean, link?: boolean, packedNative?: boolean, wrongNative?: boolean, noCharacter?: boolean, platform?: 'win32' | 'linux', notExecutable?: boolean, noTools?: boolean, wrongTool?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'anna 校验 package '))
  const stage = join(root, 'stage')
  const app = join(root, 'Anna')
  await mkdir(join(stage, 'dist/host/apps/desktop'), { recursive: true })
  await mkdir(join(stage, 'dist/renderer'), { recursive: true })
  for (const file of ['boot', 'main', 'core'])
    await writeFile(join(stage, `dist/host/apps/desktop/${file}.js`), '')
  await writeFile(join(stage, 'dist/renderer/index.html'), '')
  if (!options.noCharacter) {
    await writeFile(join(stage, 'dist/renderer/live2dcubismcore.min.js'), '')
    await writeFile(join(stage, 'dist/renderer/anna.model3.json'), '')
  }
  await writeFile(join(stage, 'package.json'), JSON.stringify({ name: 'anna', version: options.version ?? '1.0.0', main: 'dist/host/apps/desktop/boot.js' }))
  await mkdir(join(stage, 'node_modules/a'), { recursive: true })
  await writeFile(join(stage, 'node_modules/a/package.json'), JSON.stringify({ name: 'a', dependencies: { b: '1' }, optionalDependencies: { maybe: '1' }, peerDependencies: { c: '1', d: '1' }, peerDependenciesMeta: { d: { optional: true } } }))
  await mkdir(join(stage, 'node_modules/c'), { recursive: true })
  await writeFile(join(stage, 'node_modules/c/package.json'), JSON.stringify({ name: 'c' }))
  if (!options.skipDependency) {
    await mkdir(join(stage, 'node_modules/a/node_modules/b'), { recursive: true })
    await writeFile(join(stage, 'node_modules/a/node_modules/b/package.json'), JSON.stringify({ name: 'b' }))
  }
  if (options.link)
    await symlink('a', join(stage, 'node_modules/linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await mkdir(join(app, 'resources'), { recursive: true })
  const nativeFolder = join(stage, `node_modules/a/prebuilds/${options.platform === 'linux' ? 'linux' : 'win32'}-x64`)
  await mkdir(nativeFolder, { recursive: true })
  await writeFile(join(nativeFolder, 'addon.node'), options.wrongNative ? elf(183) : options.platform === 'linux' ? elf(62) : pe(0x8664))
  await createPackageWithOptions(stage, join(app, 'resources/app.asar'), options.packedNative ? {} : { unpack: '*.node' })
  if (options.platform === 'linux') {
    for (const file of ['anna', 'anna-bin', 'chrome-sandbox'])
      await writeFile(join(app, file), elf(62), { mode: options.notExecutable ? 0o644 : 0o755 })
    await writeFile(join(app, 'chrome_crashpad_handler'), elf(62), { mode: 0o755 })
    await writeFile(join(app, 'resources/favicon.png'), '')
  }
  else {
    await writeFile(join(app, 'Anna.exe'), pe(options.machine ?? 0x8664))
    await writeFile(join(app, 'resources/anna.ico'), '')
  }
  if (!options.noTools) {
    await mkdir(join(app, 'resources/bin'), { recursive: true })
    for (const tool of ['rg', 'fd']) {
      const file = options.platform === 'linux' ? tool : `${tool}.exe`
      const bytes = options.wrongTool && tool === 'fd' ? elf(183) : options.platform === 'linux' ? elf(62) : pe(0x8664)
      await writeFile(join(app, 'resources/bin', file), bytes, { mode: options.notExecutable ? 0o644 : 0o755 })
    }
  }
  if (options.leftover) {
    await mkdir(join(app, 'resources/app'), { recursive: true })
    await writeFile(join(app, 'resources/default_app.asar'), '')
  }
  return { root, app }
}

describe('binary kinds', () => {
  it('reads the format and architecture of an executable', () => {
    expect(binaryKind(pe(0x8664))).toBe('windows-x64')
    expect(binaryKind(pe(0xAA64))).toBe('windows-arm64')
    expect(binaryKind(elf(62))).toBe('linux-x64')
    expect(binaryKind(elf(183))).toBe('linux-arm64')
    expect(binaryKind(Buffer.from('#!/bin/sh'))).toBe('unknown')
  })
})

describe('package checks', () => {
  it('passes a complete Linux package, and rejects one that cannot be launched', async () => {
    const good = await fixture({ platform: 'linux' })
    const bad = await fixture({ platform: 'linux', notExecutable: true })
    try {
      expect((await checkPackage('linux', good.app, '1.0.0')).problems).toEqual([])
      if (process.platform !== 'win32')
        expect((await checkPackage('linux', bad.app, '1.0.0')).problems.join('\n')).toMatch(/anna-bin is not executable/)
      if (process.platform !== 'win32')
        expect((await checkPackage('linux', bad.app, '1.0.0')).problems.join('\n')).toMatch(/resources[\\/]bin[\\/]rg is not executable/)
    }
    finally {
      await rm(good.root, { recursive: true, force: true })
      await rm(bad.root, { recursive: true, force: true })
    }
  })

  it('passes a complete Windows package', async () => {
    const { root, app } = await fixture()
    try { expect((await checkPackage('win32', app, '1.0.0')).problems).toEqual([]) }
    finally { await rm(root, { recursive: true, force: true }) }
  })

  it.each([
    ['a build for the wrong architecture', { machine: 0xAA64 }, /Anna\.exe is windows-arm64/],
    ['a stale version', { version: '0.6.0' }, /version 0\.6\.0/],
    ['a dependency that would fail to load', { skipDependency: true }, /a needs b/],
    ['leftovers Electron would prefer or never use', { leftover: true }, /resources[\\/]app/],
    ['links inside the archive', { link: true }, /links/],
    ['a native addon the system cannot load from the archive', { packedNative: true }, /inside the archive/],
    ['a package without her character', { noCharacter: true }, /character assets/],
    ['a native addon for another system', { wrongNative: true }, /is linux-arm64/],
    ['a package without its search tools, which the agent would then fetch from GitHub', { noTools: true }, /bin[\\/]rg\.exe is missing/],
    ['a search tool for another system', { wrongTool: true }, /fd\.exe is linux-arm64/],
  ])('rejects %s', async (_name, options, problem) => {
    const { root, app } = await fixture(options)
    try { expect((await checkPackage('win32', app, '1.0.0')).problems.join('\n')).toMatch(problem) }
    finally { await rm(root, { recursive: true, force: true }) }
  })
})
