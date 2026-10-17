import type { DelegateAgent } from '../agents/adapters'
import type { AgentInfo } from '../agents/detect'
import type { ImportedProvider, Preset, ProviderApp, ProviderChoice } from '../agents/providers'
import type { AgentsSnapshot, AgentStatus, CustomProvider } from '../shared/contracts'
import type { SettingsStore } from './settings'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { approvalStyle, verified } from '../agents/adapters'
import { catalog } from '../agents/catalog'
import { detectAgents } from '../agents/detect'
import { GlobalSwitcher } from '../agents/global'
import { nodeEnvironment } from '../agents/node-environment'
import { findPreset, importCcSwitch, presetsFor } from '../agents/providers'

export interface SecretVault { read: () => Promise<string>, write: (value: string) => Promise<void> }
export interface AgentsOptions {
  locate?: (agent: DelegateAgent) => { command: string, prefix?: string[] } | undefined
  detect?: () => Promise<AgentInfo[]>
  configDirs?: Record<ProviderApp, string>
  ccSwitchDb?: string
}

const providerApps: Record<string, ProviderApp | undefined> = { claude: 'claude', codex: 'codex', gemini: 'gemini' }
export const providerAppOf = (agent: string) => providerApps[agent]

/**
 * The cc-switch side of Anna: which agents are installed, which provider each one uses when Anna delegates,
 * global switching with restore, importing cc-switch providers, and installing agents. Keys live in one encrypted
 * secret (a JSON map), never in settings.
 */
export class AgentsHub {
  private detected: AgentInfo[] = []
  private detecting?: Promise<AgentInfo[]>
  private keys?: Record<string, string>
  readonly switcher: GlobalSwitcher
  constructor(private data: string, private store: SettingsStore, private secrets: SecretVault, private options: AgentsOptions = {}) {
    const home = homedir()
    this.switcher = new GlobalSwitcher(join(data, 'agent-backups'), options.configDirs ?? { claude: join(home, '.claude'), codex: join(home, '.codex'), gemini: join(home, '.gemini') })
  }

  private get ccSwitchDb() { return this.options.ccSwitchDb ?? join(homedir(), '.cc-switch', 'cc-switch.db') }

  async refresh() {
    this.detecting = (this.options.detect ?? (() => detectAgents(nodeEnvironment())))()
    this.detected = await this.detecting
    return this.detected
  }

  async locate(agent: DelegateAgent) {
    if (this.options.locate)
      return this.options.locate(agent)
    const list = this.detected.length ? this.detected : await (this.detecting ?? this.refresh())
    const info = list.find(item => item.id === agent)
    return info?.installed && info.path ? { command: info.path } : undefined
  }

  private async allKeys() {
    if (!this.keys) {
      const raw = await this.secrets.read()
      this.keys = raw ? JSON.parse(raw) as Record<string, string> : {}
    }
    return this.keys
  }

  private async saveKey(id: string, key: string) {
    const keys = await this.allKeys()
    keys[id] = key
    await this.secrets.write(JSON.stringify(keys))
  }

  private preset(app: ProviderApp, name: string): Preset | undefined {
    const custom = this.store.value.providers?.find(item => item.app === app && item.name === name)
    return (custom?.preset as Preset | undefined) ?? findPreset(app, name)
  }

  /** The provider a delegated run of this agent should use (explicit name wins over the saved choice). */
  async choice(agent: string, name?: string): Promise<ProviderChoice | undefined> {
    const app = providerAppOf(agent)
    const chosen = name ?? this.store.value.agents?.[agent]?.provider
    if (!app || !chosen)
      return undefined
    const preset = this.preset(app, chosen)
    if (!preset)
      throw new Error(`没有找到 ${chosen} 这个服务商`)
    return { preset, key: (await this.allKeys())[`${app}:${chosen}`] }
  }

  async setProvider(agent: string, provider?: string, key?: string) {
    const app = providerAppOf(agent)
    if (!app)
      throw new Error('这个 agent 暂不支持切换服务商')
    if (provider && !this.preset(app, provider))
      throw new Error(`没有找到 ${provider} 这个服务商`)
    if (provider && key)
      await this.saveKey(`${app}:${provider}`, key.trim())
    this.store.value.agents = { ...this.store.value.agents, [agent]: { provider } }
    await this.store.save()
  }

  async applyGlobal(app: ProviderApp, provider: string) {
    const choice = await this.choice(app, provider)
    if (!choice)
      throw new Error('请先选择服务商')
    await this.switcher.apply(app, choice)
  }

  restoreGlobal(app: ProviderApp) { return this.switcher.restore(app) }

  /** Bring providers (and their keys) over from an existing cc-switch install, read-only. */
  async importCcSwitch() {
    if (!existsSync(this.ccSwitchDb))
      throw new Error('没有找到 cc-switch 的数据（~/.cc-switch/cc-switch.db）')
    const imported: ImportedProvider[] = importCcSwitch(this.ccSwitchDb)
    const providers: CustomProvider[] = [...(this.store.value.providers ?? []).filter(item => !imported.some(next => next.app === item.app && next.name === item.name))]
    for (const item of imported) {
      providers.push({ app: item.app, name: item.name, preset: item.preset })
      if (item.key)
        await this.saveKey(`${item.app}:${item.name}`, item.key)
    }
    this.store.value.providers = providers
    await this.store.save()
    return imported.length
  }

  /** Run the agent's own install command (the UI confirms first). */
  install(agent: string) {
    const entry = catalog.find(item => item.id === agent)
    if (!entry?.install)
      throw new Error('这个 agent 没有可自动执行的安装命令')
    const [command, ...args] = entry.install.split(' ')
    return new Promise<string>((resolve, reject) => execFile(process.platform === 'win32' ? `${command}.cmd` : command!, args, { timeout: 10 * 60 * 1000, shell: process.platform === 'win32' }, (error, stdout, stderr) => error ? reject(new Error(`${stderr || error.message}`.slice(-600))) : resolve(stdout.slice(-600))))
  }

  async snapshot(): Promise<AgentsSnapshot> {
    const keys = await this.allKeys().catch(() => ({} as Record<string, string>))
    const detected: AgentStatus[] = this.detected.map(info => ({ ...info, ...(info.tier === 'delegate' ? { approvals: approvalStyle[info.id as DelegateAgent], verified: verified[info.id as DelegateAgent] } : {}) }))
    const providers: AgentsSnapshot['providers'] = {}
    for (const agent of ['claude', 'codex', 'gemini']) {
      const provider = this.store.value.agents?.[agent]?.provider
      providers[agent] = { provider, hasKey: Boolean(provider && keys[`${agent}:${provider}`]) }
    }
    const presets: AgentsSnapshot['presets'] = {}
    for (const app of ['claude', 'codex', 'gemini'] as ProviderApp[]) {
      const custom = (this.store.value.providers ?? []).filter(item => item.app === app).map(item => ({ name: item.name, category: 'imported', official: false }))
      presets[app] = [...custom, ...presetsFor(app).map(preset => ({ name: preset.name, category: preset.category, official: preset.official, apiKeyUrl: preset.apiKeyUrl }))]
    }
    return {
      detected,
      providers,
      global: { claude: this.switcher.status('claude'), codex: this.switcher.status('codex'), gemini: this.switcher.status('gemini') },
      presets,
      ccSwitch: existsSync(this.ccSwitchDb),
    }
  }
}
