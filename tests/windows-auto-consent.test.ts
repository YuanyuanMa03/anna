import type { AnnaEvent } from '../packages/shared/contracts'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Host } from '../packages/anna-host/host'
import { defaultSettings, SettingsStore } from '../packages/anna-host/settings'

// Synthetic settings and no model credentials: exercise consent, never real agents or APIs.
async function setup(platform: NodeJS.Platform = 'win32', trusted = true, restoredAuto = false) {
  const data = await mkdtemp(join(tmpdir(), 'anna-auto-consent-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  await writeFile(join(data, 'settings.json'), JSON.stringify({ ...defaultSettings(), workspace, workspaces: { [workspace]: { trusted, mode: restoredAuto ? 'auto' : 'edit', rules: { allow: [], ask: [], deny: [] } } } }))
  const events: AnnaEvent[] = []
  const make = () => new Host(resolve('.'), data, { read: async () => '', write: async () => {} }, event => events.push(event), { platform, sandbox: { available: platform === 'darwin', reason: 'synthetic sandbox status' }, agents: { detect: async () => [] } })
  const host = make()
  await host.initialize()
  return { host, make, data, events }
}

describe('windows Auto consent', () => {
  it('requires explicit acknowledgement, persists it across restarts and supports revocation', async () => {
    const { host, make, data, events } = await setup()
    let restored: Host | undefined
    try {
      await expect(host.execute({ type: 'mode', mode: 'auto' })).rejects.toThrow('确认')
      expect(host.snapshot().mode).toBe('edit')
      await host.execute({ type: 'mode', mode: 'auto', acknowledge: true })
      expect(host.snapshot().mode).toBe('auto')
      expect(events.findLast(event => event.type === 'mode')).toMatchObject({ line: expect.stringContaining('没有命令沙箱') })
      expect(JSON.parse(await readFile(join(data, 'settings.json'), 'utf8')).windowsAutoAcknowledged).toBe(true)
      await host.close()
      restored = make()
      await restored.initialize()
      expect(restored.snapshot().mode).toBe('auto')
      expect(restored.effectiveMode('weixin')).toBe('ask')
      await restored.execute({ type: 'windows-auto-revoke' })
      expect(restored.snapshot().mode).toBe('ask')
      expect(restored.snapshot().settings.windowsAutoAcknowledged).toBe(false)
      await expect(restored.execute({ type: 'mode', mode: 'auto' })).rejects.toThrow('确认')
    }
    finally { await host.close(); await restored?.close(); await rm(data, { recursive: true, force: true }) }
  })

  it('keeps the previous mode when saving consent fails', async () => {
    const { host, data } = await setup()
    const save = vi.spyOn(SettingsStore.prototype, 'save').mockRejectedValueOnce(new Error('synthetic storage failure'))
    try {
      await expect(host.execute({ type: 'mode', mode: 'auto', acknowledge: true })).rejects.toThrow('synthetic storage failure')
      expect(host.snapshot().mode).toBe('edit')
      expect(host.snapshot().settings.windowsAutoAcknowledged).not.toBe(true)
    }
    finally { save.mockRestore(); await host.close(); await rm(data, { recursive: true, force: true }) }
  })

  it('serializes a consent save with workspace changes', async () => {
    const { host, data } = await setup()
    const original = host.snapshot().workspace.path
    const other = join(data, 'other')
    await mkdir(other)
    let rejectSave: (error: Error) => void = () => {}
    const save = vi.spyOn(SettingsStore.prototype, 'save').mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSave = reject }))
    const change = host.execute({ type: 'mode', mode: 'auto', acknowledge: true })
    const rejection = expect(change).rejects.toThrow('synthetic pending save')
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    const switching = host.execute({ type: 'workspace', path: other })
    try {
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(host.snapshot().workspace.path).toBe(original)
    }
    finally {
      rejectSave(new Error('synthetic pending save'))
      await rejection
      await switching
      save.mockRestore()
      await host.close()
      await rm(data, { recursive: true, force: true })
    }
  })

  it('never enables bypass in untrusted folders, even with acknowledgement', async () => {
    const { host, data } = await setup('win32', false)
    try {
      await expect(host.execute({ type: 'mode', mode: 'auto', acknowledge: true })).rejects.toThrow('信任')
      expect(host.snapshot().mode).toBe('ask')
      expect(host.snapshot().settings.windowsAutoAcknowledged).not.toBe(true)
    }
    finally { await host.close(); await rm(data, { recursive: true, force: true }) }
  })

  it('does not silently upgrade previously saved Windows Auto settings', async () => {
    const { host, data } = await setup('win32', true, true)
    try {
      expect(host.snapshot().mode).toBe('ask')
      await expect(host.execute({ type: 'mode', mode: 'auto' })).rejects.toThrow('确认')
    }
    finally { await host.close(); await rm(data, { recursive: true, force: true }) }
  })

  it('keeps macOS sandbox Auto unchanged', async () => {
    const { host, data } = await setup('darwin')
    try {
      await host.execute({ type: 'mode', mode: 'auto' })
      expect(host.snapshot().mode).toBe('auto')
      expect(host.snapshot().settings.windowsAutoAcknowledged).toBeUndefined()
    }
    finally { await host.close(); await rm(data, { recursive: true, force: true }) }
  })
})
