import type { KernelContext } from '../packages/kernels/types'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { Host } from '../packages/anna-host/host'
import { defaultSettings } from '../packages/anna-host/settings'

it.each(['session', 'always'] as const)('remembers every approved compound rule through the Host (%s)', async (scope) => {
  // Synthetic kernel: it calls the actual gate but never executes any command or contacts a model.
  const data = await mkdtemp(join(tmpdir(), 'anna-compound-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  await writeFile(join(data, 'settings.json'), JSON.stringify({ ...defaultSettings(), workspace, workspaces: { [workspace]: { trusted: true, mode: 'ask', rules: { allow: [], ask: [], deny: [] } } } }))
  let context: KernelContext | undefined
  const host = new Host(resolve('.'), data, { read: async () => 'synthetic', write: async () => {} }, () => {}, {
    sandbox: { available: false, reason: 'synthetic' },
    agents: { detect: async () => [] },
    kernel: (ctx) => {
      context = ctx
      return { capabilities: { id: 'pi', label: 'synthetic', steering: false, sessions: false, shell: 'bash' }, sessionId: 'synthetic', restored: false, tools: [], plugins: [], start: async () => {}, prompt: async () => ({ status: 'completed', text: '' }), steer: async () => {}, note: () => {}, remember: () => {}, abort: async () => {}, close: async () => {}, history: () => [] }
    },
  })
  try {
    await host.initialize()
    await host.execute({ type: 'connect' })
    const input = { command: 'npm install && pip install example' }
    const pending = context!.gate('bash', input, 'synthetic-call')
    await vi.waitFor(() => expect(host.snapshot().approvals).toHaveLength(1))
    const question = host.snapshot().approvals[0]!
    const rules = ['Bash(npm install *)', 'Bash(pip install *)']
    expect(question.rules).toEqual(rules)
    await host.execute({ type: 'approval', id: question.id, allow: true, scope })
    expect(await pending).toEqual({ allow: true })
    if (scope === 'session') {
      expect(host.snapshot().sessionRules).toEqual(rules)
      expect(host.snapshot().workspace.rules.allow).toEqual([])
    }
    else {
      expect(host.snapshot().workspace.rules.allow).toEqual(rules)
      expect(JSON.parse(await readFile(join(data, 'settings.json'), 'utf8')).workspaces[workspace].rules.allow).toEqual(rules)
    }
    expect(await context!.gate('bash', input, 'synthetic-repeat')).toEqual({ allow: true })
    expect(host.snapshot().approvals).toHaveLength(0)
  }
  finally { await host.close(); await rm(data, { recursive: true, force: true }) }
})
