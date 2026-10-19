import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { Host } from '../packages/anna-host/host'
import { scriptedBackend } from '../packages/kernels/pi/backend'
import { createPiKernel } from '../packages/kernels/pi/kernel'

it('the agents\' config backups (their original keys) are Anna\'s own data: no tool reads them, even in Auto', async () => {
  const data = await mkdtemp(join(tmpdir(), 'anna-protected-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  const backup = join(data, 'agent-backups/codex/auth.json.orig')
  await mkdir(join(data, 'agent-backups/codex'), { recursive: true })
  await writeFile(backup, '{"OPENAI_API_KEY":"sk-user-original"}')
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'haru', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'auto', rules: { allow: [], ask: [], deny: [] } } } }))
  const backend = await scriptedBackend([{ tools: [{ name: 'read', args: { path: backup } }] }, { tools: [{ name: 'bash', args: { command: `cat ${backup}` } }] }, { text: '好的。' }], data)
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, () => {}, { sandbox: { available: false, reason: 'test' }, kernel: context => createPiKernel(context, backend), agents: { detect: async () => [] } })
  await host.initialize()
  await host.execute({ type: 'send', text: '看看那个备份' })
  const sessions = join(data, 'pi-sessions')
  const files = (await readdir(sessions, { recursive: true })).filter(file => String(file).endsWith('.jsonl'))
  const seen = (await Promise.all(files.map(file => readFile(join(sessions, String(file)), 'utf8')))).join('\n')
  expect(seen.match(/Anna 自己的密钥与数据/g)?.length).toBe(2)
  expect(seen).not.toContain('sk-user-original')
  await host.close()
})
