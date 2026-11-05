import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { longestPath, pruneRuntime, runtimeDeployFlags } from '../scripts/package-runtime.mjs'
import { packagedExecutable, startupState } from '../scripts/smoke-package.mjs'

async function fixture(files: string[]) {
  const root = join(await mkdtemp(join(tmpdir(), 'anna 打包 runtime-')), 'node_modules')
  for (const file of files) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), 'x')
  }
  return root
}

describe('runtime packaging', () => {
  it('deploys a flat tree instead of a deep pnpm store', () => {
    expect(runtimeDeployFlags).toContain('--config.node-linker=hoisted')
  })

  it('removes type declarations, source maps and tools the app never runs', async () => {
    const root = await fixture([
      'a/index.js',
      'a/index.d.ts',
      'a/index.d.mts',
      'a/index.d.cts',
      'a/index.js.map',
      'a/index.mjs.map',
      'a/index.d.ts.map',
      'a/style.css.map',
      'typescript/lib/typescript.js',
      'electron/index.js',
      'b/node_modules/typescript/lib/typescript.js',
      '.bin/electron',
      'b/node_modules/.bin/tool',
    ])
    await pruneRuntime(root)
    expect(existsSync(join(root, 'a/index.js'))).toBe(true)
    for (const gone of ['a/index.d.ts', 'a/index.d.mts', 'a/index.d.cts', 'a/index.js.map', 'a/index.mjs.map', 'a/index.d.ts.map', 'a/style.css.map', 'typescript', 'electron', 'b/node_modules/typescript', '.bin', 'b/node_modules/.bin'])
      expect(existsSync(join(root, gone)), gone).toBe(false)
  })

  it('keeps data files that merely look similar, and a folder named like a tool below a package', async () => {
    const root = await fixture(['a/data.map', 'a/types.ts', 'a/typescript/keep.js', 'a/electron/keep.js', 'sandbox/vendor/seccomp/x64/apply-seccomp'])
    await pruneRuntime(root)
    for (const kept of ['a/data.map', 'a/types.ts', 'a/typescript/keep.js', 'a/electron/keep.js', 'sandbox/vendor/seccomp/x64/apply-seccomp'])
      expect(existsSync(join(root, kept)), kept).toBe(true)
  })
})

describe('path budget', () => {
  it('measures the longest path below a folder', async () => {
    const root = await fixture(['a/b/c.js', 'short.js'])
    expect(await longestPath(root)).toBe(join('a', 'b', 'c.js').length)
  })
})

describe('package smoke test', () => {
  it('finds the packaged executable of each platform', () => {
    expect(packagedExecutable('win32', 'C:\\repo with space', win32.join)).toBe('C:\\repo with space\\dist\\windows\\Anna\\Anna.exe')
    expect(packagedExecutable('darwin', '/repo')).toBe(join('/repo', 'dist/macos/Anna.app/Contents/MacOS/Anna'))
    expect(packagedExecutable('linux', '/repo')).toBe(join('/repo', 'dist/linux/Anna/anna'))
  })

  it('passes only after both the core and the window came up', () => {
    expect(startupState('')).toBe('waiting')
    expect(startupState('t [main] core ready\n')).toBe('waiting')
    expect(startupState('t [main] window loaded\n')).toBe('waiting')
    expect(startupState('t [main] window loaded\nt [main] core ready\n')).toBe('ready')
  })

  it('fails at once when the core gave up or a window could not load', () => {
    expect(startupState('t [main] core gave up after repeated exits\n')).toBe('failed')
    expect(startupState('t [main] window failed to load: -6\n')).toBe('failed')
    expect(startupState('t [main] window loaded\nt [main] core ready\nt [main] core exited with code 1\n')).toBe('failed')
    expect(startupState('t [main] window loaded\nt [main] core ready\nt [main] core gave up after repeated exits\n')).toBe('failed')
  })
})
