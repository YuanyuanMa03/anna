import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateCommand } from '../apps/web/commands'
import { providerKeys, relayProvider, seedVisitor } from '../apps/web/seed'
import { migrate } from '../packages/anna-host/settings'

describe('online demo commands', () => {
  it('lets a visitor use Anna, including delegation, modes and approvals', () => {
    for (const command of [{ type: 'send', text: '@codex 修一下测试' }, { type: 'mode', mode: 'auto' }, { type: 'approval', id: 'a', allow: true, scope: 'session' }, { type: 'kernel', id: 'claude-code' }, { type: 'undo', taskId: 't' }])
      expect(validateCommand(command)).toEqual(command)
  })
  it('keeps what reaches outside the visitor\'s home on the desktop', () => {
    for (const command of [{ type: 'configure', model: {}, key: 'k' }, { type: 'choose-workspace' }, { type: 'workspace', path: '/' }, { type: 'providers-export', includeKeys: true }, { type: 'provider-save', app: 'codex', name: 'x', baseUrl: 'http://169.254.169.254' }, { type: 'agent-install', agent: 'claude' }, { type: 'weixin-login' }])
      expect(() => validateCommand(command)).toThrow()
    expect(() => validateCommand({ type: 'agent-provider', agent: 'claude', provider: 'DeepSeek', key: 'sk-x' })).toThrow()
    expect(() => validateCommand({ type: 'send', text: '' })).toThrow()
  })
})

describe('online demo seed', () => {
  it('points Anna, Claude Code and Codex at the relay and lays out a demo project', async () => {
    const data = await mkdtemp(join(tmpdir(), 'anna-web-seed-'))
    try {
      await seedVisitor(data, { relay: 'http://127.0.0.1:7870/v1', model: 'm1', agentModel: 'm2' })
      const settings = migrate(JSON.parse(await readFile(join(data, 'settings.json'), 'utf8')))
      expect(settings.model).toMatchObject({ provider: 'custom', model: 'm1', baseURL: 'http://127.0.0.1:7870/v1' })
      expect(settings.agents).toEqual({ claude: { provider: relayProvider }, codex: { provider: relayProvider } })
      expect(settings.providers?.map(p => [p.app, (p.preset as { apiFormat?: string }).apiFormat])).toEqual([['claude', 'openai_chat'], ['codex', 'openai_chat']])
      expect(await readFile(join(data, 'workspace/README.md'), 'utf8')).toContain('示例项目')
      expect(await readFile(join(data, 'workspace/src/planner.js'), 'utf8')).toContain('days - 1')
      expect(await readFile(join(data, 'workspace/.git/HEAD'), 'utf8')).toContain('main')
      expect(JSON.parse(providerKeys('t'))).toEqual({ [`claude:${relayProvider}`]: 't', [`codex:${relayProvider}`]: 't' })
    }
    finally { await rm(data, { recursive: true, force: true }) }
  })
})
