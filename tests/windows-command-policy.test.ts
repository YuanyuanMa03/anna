import { describe, expect, it } from 'vitest'
import { classify, classifyIn, segments } from '../packages/permissions/commands'
import { canonical, isInside, isSecretFile, resolveToolPath } from '../packages/permissions/paths'

describe('windows shell classification (synthetic commands, never executed)', () => {
  const recursive = ['r', 're', 'rec', 'recu', 'recur', 'recurs', 'recurse']
  it.each(['Remove-Item', 'ri', 'rm', 'del', 'erase', 'rd', 'rmdir'].flatMap(alias => recursive.map(flag => `${alias} build -${flag}`)))('%s is high risk', (command) => {
    expect(classify(command, 'win32')).toBe('danger')
  })
  it.each([
    'REMOVE-ITEM -RECURSE:$true build',
    'ri -r:$false build',
    'rd /s /q build',
    'Stop-Process -Id 42 -Force',
    'spps -Id 42 -f',
    'kill -Id 42 -fo',
    'taskkill.exe /pid 42 /f',
    'Set-ExecutionPolicy RemoteSigned',
    'reg delete HKCU\\Software\\Anna',
    'reg.exe ADD HKCU\\Software\\Anna',
    'Remove-ItemProperty HKCU:\\Software\\Anna Name',
    'rp HKCU:\\Software\\Anna Name',
    'Start-Process powershell -Verb RunAs',
    'start powershell -v runas',
    'iex "Write-Output hello"',
    'Invoke-Expression $code',
    'icacls.exe . /grant Everyone:F',
    'takeown /f .',
    'schtasks.exe /create /tn Anna /tr cmd',
  ])('%s is high risk', (command) => {
    expect(classify(command, 'win32')).toBe('danger')
  })
  it.each([
    'Get-Process',
    'Get-Date',
    'Set-Location src',
    'sl src',
    'where node',
    'where.exe node',
    'findstr /s TODO *.txt',
    'Get-Help Get-ChildItem',
    '$PSVersionTable',
    'Get-ChildItem . | Select-Object Name | Where-Object Length -gt 0 | Sort-Object Name | Format-Table | Measure-Object',
    'dir C:\\',
  ])('%s is read-only', (command) => {
    expect(classify(command, 'win32')).toBe('inspect')
  })
  it.each([
    'Get-ChildItem | Where-Object { Remove-Item $_ }',
    'Get-Date > date.txt',
    '$PSVersionTable.Clear()',
    'Get-Process $processName',
    'Select-Object @{ Name="x"; Expression={ Start-Process cmd } }',
  ])('%s is not read-only', (command) => {
    expect(classify(command, 'win32')).not.toBe('inspect')
  })
  it('keeps Windows paths intact and keeps git after a directory change executable', () => {
    expect(segments('Set-Location C:\\; Get-ChildItem', 'win32')).toEqual(['Set-Location C:\\', 'Get-ChildItem'])
    const parts = ['sl src', 'git status']
    expect(classifyIn(parts, 'git status', 'win32')).toBe('change')
  })
  it('preserves Unix behavior', () => {
    expect(classify('ls -la && git status', 'darwin')).toBe('inspect')
    expect(classify('rm -rf build', 'darwin')).toBe('danger')
    expect(classify('sl src', 'darwin')).toBe('change')
  })
})

describe('windows path rules on every test host (synthetic paths)', () => {
  const workspace = 'C:\\Users\\Alice\\project'
  const home = 'C:\\Users\\Alice'
  it.each([
    [workspace, true],
    [`${workspace}\\src\\a.ts`, true],
    ['c:/users/alice/PROJECT/src/a.ts', true],
    [`${workspace}\\..\\outside\\a.ts`, false],
    [`${workspace}-other\\a.ts`, false],
    ['D:\\Users\\Alice\\project\\a.ts', false],
    ['\\\\server\\share\\project\\a.ts', false],
  ])('contains %s: %s', (target, inside) => {
    expect(isInside(workspace, target, 'win32')).toBe(inside)
  })
  it('handles UNC shares and case correctly', () => {
    expect(isInside('\\\\server\\share\\project', '\\\\SERVER\\SHARE\\project\\a.ts', 'win32')).toBe(true)
    expect(isInside('\\\\server\\share\\project', '\\\\server\\other\\project\\a.ts', 'win32')).toBe(false)
    expect(isInside('/Users/Alice/project', '/Users/Alice/project/src', 'darwin')).toBe(true)
    expect(isInside('/home/alice/project', '/home/alice/PROJECT/src', 'linux')).toBe(false)
  })
  it.each([
    ['src/a.ts', `${workspace}\\src\\a.ts`],
    ['@src\\a.ts', `${workspace}\\src\\a.ts`],
    ['~\\notes.txt', `${home}\\notes.txt`],
    ['/c/Users/Alice/project/a.ts', `${workspace}\\a.ts`],
    ['/mnt/c/Users/Alice/project/a.ts', `${workspace}\\a.ts`],
    ['file:///C:/Users/Alice/project/a.ts', `${workspace}\\a.ts`],
    ['D:\\outside\\a.ts', 'D:\\outside\\a.ts'],
  ])('resolves %s with Windows semantics', (input, expected) => {
    expect(resolveToolPath(input, workspace, 'win32', home)).toBe(expected)
  })
  it('does not resolve foreign Windows paths against the host cwd', () => {
    expect(canonical(`${workspace}\\missing.txt`)).toBe(`${workspace}\\missing.txt`)
    expect(canonical('\\Users\\Alice\\project\\missing.txt')).toBe('\\Users\\Alice\\project\\missing.txt')
  })
  it.each(['.env', '.ENV.local', 'id_ed25519', '.npmrc', '.codex\\auth.json', '.CLAUDE\\SETTINGS.JSON', '.aws\\credentials'])('recognizes secret %s', (file) => {
    expect(isSecretFile(`${home}\\${file}`, home, 'win32')).toBe(true)
  })
  it('does not confuse project configuration with home credentials', () => {
    expect(isSecretFile(`${workspace}\\.claude\\settings.json`, home, 'win32')).toBe(false)
    expect(isSecretFile(`${workspace}\\.env.example`, home, 'win32')).toBe(false)
  })
})
