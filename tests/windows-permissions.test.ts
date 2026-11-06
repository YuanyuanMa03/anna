import type { PolicyContext } from '../packages/permissions/engine'
import { describe, expect, it } from 'vitest'
import { decide } from '../packages/permissions/engine'

// Synthetic paths exercise Windows policy on every test host; no shell or real files are used.
function context(mode: PolicyContext['mode'] = 'auto', extra: Partial<PolicyContext> = {}): PolicyContext {
  return {
    mode,
    workspace: 'C:\\work',
    sandboxed: false,
    platform: 'win32',
    home: 'C:\\Users\\tester',
    rules: { allow: [], deny: [], ask: [] },
    protectedPaths: ['C:\\Users\\tester\\AppData\\Roaming\\Anna'],
    tempDirs: ['C:\\Temp'],
    ...extra,
  }
}
const command = (text: string, mode: PolicyContext['mode'] = 'auto', extra: Partial<PolicyContext> = {}) => decide('powershell', { command: text }, context(mode, extra))

describe('windows unsandboxed permission modes', () => {
  it('allows routine commands in acknowledged Auto mode without claiming a sandbox', () => {
    for (const text of ['npm install', 'git fetch', 'node tools/generate.js', 'Set-Content notes.txt hello']) {
      const result = command(text)
      expect(result.kind, text).toBe('allow')
      expect(result).not.toHaveProperty('note', '沙箱')
    }
  })

  it('keeps high risk commands one-time even with an allow rule', () => {
    for (const text of ['ri -r build', 'rm -Recurse build', 'Stop-Process -Force -Name node', 'taskkill /f /im node.exe', 'Set-ExecutionPolicy Bypass', 'reg add HKCU\\Software\\Example', 'iex script', 'schtasks /create /tn example']) {
      const result = command(text, 'auto', { rules: { allow: ['Bash(*)'], deny: [], ask: [] } })
      expect(result, text).toMatchObject({ kind: 'ask', danger: true })
      expect(result).not.toHaveProperty('rule')
      expect(result).not.toHaveProperty('rules')
    }
  })

  it('requires one-time approval for outside-workspace writes despite saved rules', () => {
    const rules = { allow: ['Edit(//C:/outside/**)', 'Bash(*)', 'Read(//C:/outside/**)'], deny: [], ask: [] }
    for (const mode of ['ask', 'edit', 'auto'] as const) {
      const result = decide('write', { path: 'C:\\outside\\file.txt' }, context(mode, { rules }))
      expect(result, mode).toMatchObject({ kind: 'ask', danger: true })
    }
    for (const text of ['Set-Content C:\\outside\\file.txt hello', 'Copy-Item .\\a.txt C:\\outside\\a.txt', 'Set-Content C:\\Temp\\file.txt hello'])
      expect(command(text, 'auto', { rules }), text).toMatchObject({ kind: 'ask', danger: true })
  })

  it('asks each time for secrets even with an exact saved read rule', () => {
    const rules = { allow: ['Read(./.env)', 'Bash(*)'], deny: [], ask: [] }
    for (const mode of ['plan', 'ask', 'edit', 'auto'] as const) {
      for (const result of [decide('read', { path: '.env' }, context(mode, { rules })), command('Get-Content .env', mode, { rules })]) {
        expect(result).toMatchObject({ kind: 'ask', danger: true })
        expect(result).not.toHaveProperty('rule')
        expect(result).not.toHaveProperty('rules')
      }
    }
  })

  it('does not treat piped file contents as metadata', () => {
    expect(command('Get-ChildItem .env | Get-Content')).toMatchObject({ kind: 'ask', danger: true })
    expect(command('findstr /g:.env notes.txt')).toMatchObject({ kind: 'ask', danger: true })
    expect(command('Get-ChildItem .env | Select-Object Name').kind).toBe('allow')
  })

  it('checks PowerShell colon-bound path parameters and their abbreviations', () => {
    for (const flag of ['-Path:', '-LiteralPath:', '-Pa:', '-Li:']) {
      expect(command(`Get-Content ${flag}C:\\Users\\tester\\AppData\\Roaming\\Anna\\settings.json`).kind).toBe('deny')
      expect(command(`Get-Content ${flag}.env`)).toMatchObject({ kind: 'ask', danger: true })
      expect(command(`Set-Content ${flag}C:\\outside\\x.txt hello`)).toMatchObject({ kind: 'ask', danger: true })
      expect(command(`Set-Content ${flag}C:\\outside\\x.txt hello`, 'edit')).toMatchObject({ kind: 'ask', danger: true })
    }
  })

  it('checks every literal PowerShell array path without splitting quoted commas', () => {
    expect(command('Get-Content .env,notes.txt')).toMatchObject({ kind: 'ask', danger: true })
    expect(command('Set-Content C:\\work\\a.txt,C:\\outside\\b.txt hi')).toMatchObject({ kind: 'ask', danger: true })
    expect(command('Get-Content C:\\work\\a.txt,C:\\Users\\tester\\AppData\\Roaming\\Anna\\settings.json').kind).toBe('deny')
    expect(command('Get-Content "notes,old.txt"').kind).toBe('allow')
  })

  it('asks once for wildcard content reads and enumeration-to-content pipelines', () => {
    for (const text of ['Get-Content .env*', 'Get-Content -Path:.env*', 'gc *', 'Get-ChildItem -Force | Get-Content', 'Get-ChildItem -Force -Recurse . | Select-Object -ExpandProperty FullName | Get-Content'])
      expect(command(text), text).toMatchObject({ kind: 'ask', danger: true })
    expect(command('Get-ChildItem -Force | Select-Object Name | Format-Table').kind).toBe('allow')
    expect(command('Get-ChildItem C:\\Users\\tester\\AppData\\Roaming -Recurse | Get-Content').kind).toBe('deny')
  })

  it('never opens Anna data through tools, commands or cwd changes', () => {
    const path = 'C:\\Users\\tester\\AppData\\Roaming\\Anna\\settings.json'
    expect(decide('read', { path }, context()).kind).toBe('deny')
    expect(decide('write', { path }, context()).kind).toBe('deny')
    expect(command(`Get-Content ${path}`).kind).toBe('deny')
    expect(command('Get-Content $HOME\\AppData\\Roaming\\Anna\\settings.json').kind).toBe('deny')
    expect(command('sl C:\\Users\\tester\\AppData\\Roaming\\Anna; Get-Content settings.json').kind).toBe('deny')
  })

  it('permits only explicit workspace mutators and verification in Edit mode', () => {
    for (const text of ['Set-Content notes.txt hello', 'Add-Content notes.txt hello', 'New-Item notes.txt -ItemType File', 'Copy-Item a.txt b.txt', 'Move-Item a.txt b.txt', 'Rename-Item a.txt b.txt', 'pnpm test', 'npm run build'])
      expect(command(text, 'edit').kind, text).toBe('allow')
    for (const text of ['node scripts/write.js', 'npm install', 'git checkout main', 'Set-Content $target hello', 'Set-Content notes.txt hello > result.txt'])
      expect(command(text, 'edit').kind, text).toBe('ask')
    expect(command('Set-Content notes.txt hello', 'plan').kind).toBe('deny')
    expect(command('Set-Content notes.txt hello', 'ask').kind).toBe('ask')
  })

  it('tracks Set-Location and sl before evaluating relative destinations', () => {
    expect(command('Set-Location C:\\outside; Set-Content file.txt hello', 'edit')).toMatchObject({ kind: 'ask', danger: true })
    expect(command('sl C:\\outside; Get-Content .env')).toMatchObject({ kind: 'ask', danger: true })
    expect(command('Set-Location C:\\work; Set-Content file.txt hello', 'edit').kind).toBe('allow')
    expect(command('sl C:\\outside; generator', 'auto', { rules: { allow: ['Bash(*)'], deny: [], ask: [] } })).toMatchObject({ kind: 'ask', danger: true })
  })

  it('allows metadata pipelines without treating cmd switches or secret names as reads', () => {
    for (const text of ['dir /b', 'findstr /s pattern *.txt', 'Get-ChildItem .env | Select-Object Name | Sort-Object Name | Format-Table | Measure-Object', '$PSVersionTable', 'Get-Process', 'Get-Date', 'Get-Help Get-Process'])
      expect(command(text, 'plan').kind, text).toBe('allow')
  })

  it('offers separate rules only when every uncovered command part has a safe template', () => {
    expect(command('npm install && pip install example', 'ask')).toMatchObject({ kind: 'ask', rules: ['Bash(npm install *)', 'Bash(pip install *)'] })
    const unknown = command('npm install && git -c core.hooksPath=.hooks checkout main', 'ask')
    expect(unknown.kind).toBe('ask')
    expect(unknown).not.toHaveProperty('rules')
    expect(command('npm install', 'ask')).toMatchObject({ kind: 'ask', rule: 'Bash(npm install *)', rules: ['Bash(npm install *)'] })
  })

  it('preserves macOS no-sandbox behavior and saved per-file secret rules', () => {
    const mac: PolicyContext = { ...context(), platform: 'darwin', workspace: '/synthetic-work', home: '/synthetic-home', protectedPaths: [], tempDirs: [] }
    expect(decide('bash', { command: 'npm install' }, mac).kind).toBe('ask')
    expect(decide('read', { path: '.env' }, { ...mac, rules: { allow: ['Read(./.env)'], deny: [], ask: [] } }).kind).toBe('allow')
  })
})
