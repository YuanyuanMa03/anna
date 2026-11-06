import { join, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bundledTools, packagedExecutable, startupState } from '../scripts/smoke-package.mjs'

describe('package smoke test', () => {
  it('finds the packaged executable of each platform', () => {
    expect(packagedExecutable('win32', 'C:\\repo with space', win32.join)).toBe('C:\\repo with space\\dist\\windows\\Anna\\Anna.exe')
    expect(packagedExecutable('darwin', '/repo')).toBe(join('/repo', 'dist/macos/Anna.app/Contents/MacOS/Anna'))
    expect(packagedExecutable('linux', '/repo')).toBe(join('/repo', 'dist/linux/Anna/anna'))
  })

  it('finds the search tools the agent will run, beside each executable', () => {
    expect(bundledTools('win32', 'C:\\Program Files\\Anna\\Anna.exe', win32)).toEqual(['C:\\Program Files\\Anna\\resources\\bin\\rg.exe', 'C:\\Program Files\\Anna\\resources\\bin\\fd.exe'])
    expect(bundledTools('darwin', '/A/Anna.app/Contents/MacOS/Anna')).toEqual([join('/A/Anna.app/Contents/Resources/bin/rg'), join('/A/Anna.app/Contents/Resources/bin/fd')])
    expect(bundledTools('linux', '/opt/Anna/anna')).toEqual([join('/opt/Anna/resources/bin/rg'), join('/opt/Anna/resources/bin/fd')])
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
    expect(startupState('t [main] startup failed: Error\n')).toBe('failed')
    expect(startupState('t [main] window loaded\nt [main] core ready\nt [main] core exited with code 1\n')).toBe('failed')
    expect(startupState('t [main] window loaded\nt [main] core ready\nt [main] core gave up after repeated exits\n')).toBe('failed')
  })
})
