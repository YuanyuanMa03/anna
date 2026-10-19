import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { webGate } from '../apps/web/policy'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'anna-web-policy-'))
  directories.push(directory)
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const delegate = vi.fn(async () => ({ allow: true as const }))
  return { directory, workspace, delegate, gate: webGate(workspace, delegate) }
}

describe('public web workspace boundary', () => {
  it('blocks shells and delegation even when the desktop permission gate would allow them', async () => {
    const { gate, delegate } = fixture()
    for (const tool of ['bash', 'powershell', 'anna_delegate', 'anna_providers'])
      expect((await gate(tool, {}, 'test')).allow).toBe(false)
    expect(delegate).not.toHaveBeenCalled()
  })
  it('blocks parent paths, symlinks, and pi path spellings pointing outside the visitor workspace', async () => {
    const { directory, workspace, gate, delegate } = fixture()
    symlinkSync(directory, join(workspace, 'escape'))
    for (const path of ['../settings.json', 'escape/settings.json', '@../settings.json', `file://${directory}/settings.json`, '~/.ssh/id_rsa'])
      expect((await gate('read', { path }, 'test')).allow).toBe(false)
    expect(delegate).not.toHaveBeenCalled()
  })
  it('retains the original permission gate for workspace operations and memory', async () => {
    const { gate, delegate } = fixture()
    expect((await gate('write', { path: 'new/note.md', content: 'synthetic validation input' }, 'test')).allow).toBe(true)
    expect((await gate('anna_memory', { action: 'list' }, 'test')).allow).toBe(true)
    expect(delegate).toHaveBeenCalledTimes(2)
  })
  it('limits file size and rejects malformed tool paths', async () => {
    const { gate } = fixture()
    expect((await gate('write', { path: 'large.txt', content: 'a'.repeat(100001) }, 'test')).allow).toBe(false)
    expect((await gate('read', { path: [] }, 'test')).allow).toBe(false)
  })
})
