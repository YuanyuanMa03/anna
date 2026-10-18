import type { RuntimeSnapshot } from '../packages/shared/contracts'
import { expect, it } from 'vitest'
import { trayTemplate } from '../apps/desktop/tray-menu'

const snapshot = (agents: Partial<RuntimeSnapshot['agents']>) => ({ settings: { characterId: 'mark' }, agents: { detected: [], providers: {}, global: {}, presets: {}, mine: {}, universal: [], speed: {}, usage: {}, ccSwitch: false, ...agents } }) as unknown as RuntimeSnapshot

it('before the core answers: open and quit only', () => {
  expect(trayTemplate(undefined).map(item => item.label ?? item.type)).toEqual(['打开 Anna', 'separator', '退出 Anna'])
})

it('per app with providers: who uses which (radio), global switch to providers with a key, restore', () => {
  const template = trayTemplate(snapshot({
    mine: { codex: [{ name: 'DeepSeek', source: 'preset', category: 'cn_official', hasKey: true }, { name: 'Kimi', source: 'preset', category: 'cn_official', hasKey: false }], claude: [] },
    providers: { codex: { provider: 'DeepSeek', hasKey: true } },
    global: { codex: { switched: true, provider: 'DeepSeek' } },
  }))
  expect(template.map(item => item.label ?? item.type)).toEqual(['打开 Anna', 'separator', 'Codex：DeepSeek', 'separator', '退出 Anna'])
  const codex = template[2]!.submenu!
  // The companion on stage does the choosing; Mark here.
  expect(codex[0]).toEqual({ label: '马克君用哪个', enabled: false })
  expect(codex.filter(item => item.type === 'radio').map(item => [item.label, item.checked, item.run])).toEqual([
    ['它自己的登录', false, { type: 'agent-provider', agent: 'codex' }],
    ['DeepSeek', true, { type: 'agent-provider', agent: 'codex', provider: 'DeepSeek' }],
    ['Kimi', false, { type: 'agent-provider', agent: 'codex', provider: 'Kimi' }],
  ])
  const global = codex.find(item => item.label === '应用到全局')!
  expect(global.submenu!.map(item => [item.label, item.checked])).toEqual([['DeepSeek', true]])
  expect(codex.find(item => item.label === '恢复原配置')!.run).toEqual({ type: 'provider-restore', app: 'codex' })
})
