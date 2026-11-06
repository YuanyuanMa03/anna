import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { searchScope } from '../packages/permissions/commands'
import { decide } from '../packages/permissions/engine'
import { secretsIn } from '../packages/permissions/secrets'

// Only command text is parsed; findstr is never executed. The scanner reads synthetic local fixtures.
let directory = ''
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'anna-findstr-'))
  await mkdir(join(directory, 'src'))
  await writeFile(join(directory, '.gitignore'), '.env*\n*.pem\n')
  await mkdir(join(directory, '.git'))
  await writeFile(join(directory, 'src', '.env'), 'synthetic secret fixture\n')
  await writeFile(join(directory, 'src', 'client.pem'), 'synthetic key fixture\n')
  await writeFile(join(directory, 'src', 'notes.txt'), 'synthetic public fixture\n')
})
afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

function found(command: string) {
  const scope = searchScope(command, 'win32')
  expect(scope, command).toBeDefined()
  // Relative Windows path segments map to the same real synthetic fixture on this host.
  return scope!.targets.flatMap(target => secretsIn(resolve(directory, ...target.split(/[\\/]/)), scope!))
}

describe('windows findstr secret search scope', () => {
  it.each(['findstr /s SECRET src\\*', 'findstr /S /i SECRET src\\*.*', 'findstr.exe /s /c:SECRET src\\*', 'findstr /s /g:patterns.txt src\\*'])('detects hidden and ignored secrets in %s', (command) => {
    expect(found(command)).toContain(join(directory, 'src', '.env'))
  })
  it('keeps directories separate from literal or file-supplied patterns', () => {
    expect(found('findstr /s /d:src /c:SECRET *')).toContain(join(directory, 'src', '.env'))
    expect(found('findstr /s /g:patterns.txt src\\*.txt')).toEqual([])
    expect(found('findstr /s /g:patterns.txt src\\*.PEM')).toContain(join(directory, 'src', 'client.pem'))
  })
  it('scans the known prefix of wildcard directories conservatively', () => {
    expect(found('findstr /s SECRET s*\\*')).toContain(join(directory, 'src', '.env'))
  })
  it('asks before native Windows recursive secret searches, even under saved broad rules', () => {
    expect(found('findstr /s SECRET src\\*')).toContain(join(directory, 'src', '.env'))
    if (process.platform !== 'win32')
      return
    const result = decide('powershell', { command: 'findstr /s SECRET src\\*' }, { mode: 'auto', workspace: directory, home: directory, protectedPaths: [], tempDirs: [], platform: process.platform, sandboxed: false, rules: { allow: ['Bash(*)', 'Read(**)'], ask: [], deny: [] } })
    expect(result).toMatchObject({ kind: 'ask', danger: true })
    expect(result).not.toHaveProperty('rule')
  })
})
