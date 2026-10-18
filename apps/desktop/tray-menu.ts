import type { Command, RuntimeSnapshot } from '../../packages/shared/contracts'
import { companion } from '../../packages/character/manifest'

/** A menu item as Electron's `Menu.buildFromTemplate` takes it, minus Electron (so it can be tested in Node). */
export interface TrayItem {
  label?: string
  type?: 'normal' | 'separator' | 'submenu' | 'radio'
  checked?: boolean
  enabled?: boolean
  submenu?: TrayItem[]
  /** What clicking runs: a core command, or one of the app's own actions. */
  run?: Command | 'show' | 'quit'
}

const labels = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' } as const

/**
 * The tray menu, cc-switch style: per app, which provider the companion uses (radio), switching the app's own
 * config globally to a provider with a saved key, and restoring it. Apps with no providers of their own are left out.
 */
export function trayTemplate(snapshot: RuntimeSnapshot | undefined): TrayItem[] {
  const open: TrayItem = { label: '打开 Anna', run: 'show' }
  const quit: TrayItem = { label: '退出 Anna', run: 'quit' }
  if (!snapshot)
    return [open, { type: 'separator' }, quit]
  const who = companion(snapshot.settings.characterId).name
  const agents = snapshot.agents
  const apps = (Object.keys(labels) as (keyof typeof labels)[]).filter(app => agents.mine?.[app]?.length)
  const sections = apps.map((app): TrayItem => {
    const mine = agents.mine[app]!
    const inUse = agents.providers[app]?.provider
    const global = agents.global[app]
    const withKey = mine.filter(provider => provider.hasKey)
    return {
      label: `${labels[app]}：${inUse ?? '自己的登录'}`,
      type: 'submenu',
      submenu: [
        { label: `${who}用哪个`, enabled: false },
        { label: '它自己的登录', type: 'radio', checked: !inUse, run: { type: 'agent-provider', agent: app } },
        ...mine.map((provider): TrayItem => ({ label: provider.name, type: 'radio', checked: inUse === provider.name, run: { type: 'agent-provider', agent: app, provider: provider.name } })),
        { type: 'separator' },
        { label: global?.switched ? `全局：${global.provider}` : '全局：未修改', enabled: false },
        ...(withKey.length ? [{ label: '应用到全局', type: 'submenu' as const, submenu: withKey.map((provider): TrayItem => ({ label: provider.name, type: 'radio', checked: global?.switched === true && global.provider === provider.name, run: { type: 'provider-global', app, provider: provider.name } })) }] : []),
        ...(global?.switched ? [{ label: '恢复原配置', run: { type: 'provider-restore', app } as Command }] : []),
      ],
    }
  })
  return [open, ...(sections.length ? [{ type: 'separator' as const }, ...sections] : []), { type: 'separator' }, quit]
}
