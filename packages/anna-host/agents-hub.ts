import type { DelegateAgent } from '../agents/adapters'
import type { AgentInfo } from '../agents/detect'
import type { ImportedProvider, Preset, ProviderApp, ProviderChoice } from '../agents/providers'
import type { AgentsSnapshot, AgentStatus, CustomProvider, MyProvider, ProviderDraft } from '../shared/contracts'
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
const apps: ProviderApp[] = ['claude', 'codex', 'gemini']

/** Where each app keeps its endpoint and model when the provider speaks through env vars. */
const envFields: Partial<Record<ProviderApp, { url: string, model: string }>> = { claude: { url: 'ANTHROPIC_BASE_URL', model: 'ANTHROPIC_MODEL' }, gemini: { url: 'GOOGLE_GEMINI_BASE_URL', model: 'GEMINI_MODEL' } }

/**
 * An endpoint a key may be sent to: HTTPS anywhere, plain HTTP only to this machine or the local network (Ollama,
 * LM Studio, vLLM), never with credentials, a query or a fragment in the URL.
 */
export function providerEndpoint(value: string) {
  let url: URL
  try { url = new URL(value.trim()) }
  catch { throw new Error('请求地址不是有效的网址') }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const local = host === 'localhost' || host === '::1' || host.endsWith('.local') || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
  if (url.username || url.password || url.search || url.hash)
    throw new Error('请求地址里不能带账号、密码或查询参数')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new Error('请求地址必须是 HTTPS（只有本机或局域网地址可以用 HTTP）')
  return url.toString().replace(/\/$/, '')
}

/** Endpoint and model as the UI shows them, wherever the app keeps them. */
function describe(app: ProviderApp, preset: Preset) {
  const fields = envFields[app]
  return fields ? { baseUrl: preset.env?.[fields.url], model: preset.env?.[fields.model] } : { baseUrl: preset.baseUrl, model: preset.model }
}

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

  /** The user's own providers for one app; a provider chosen before this list existed shows up as well. */
  mine(app: ProviderApp, keys: Record<string, string>): MyProvider[] {
    const listed = (this.store.value.providers ?? []).filter(item => item.app === app)
    const chosen = this.store.value.agents?.[app]?.provider
    const legacy = chosen && !listed.some(item => item.name === chosen) ? findPreset(app, chosen) : undefined
    const entries: { name: string, source: MyProvider['source'], preset: Preset }[] = [
      ...listed.map(item => ({ name: item.name, source: item.source ?? (item.preset.category === 'imported' ? 'imported' : 'preset'), preset: item.preset as Preset })),
      ...(legacy ? [{ name: legacy.name, source: 'preset' as const, preset: legacy }] : []),
    ]
    return entries.map(({ name, source, preset }) => ({ name, source, category: preset.category, ...describe(app, preset), website: preset.website, apiKeyUrl: preset.apiKeyUrl, hasKey: Boolean(keys[`${app}:${name}`]) }))
  }

  /**
   * Add a provider (from a preset or by hand) or edit one: endpoint and model can be overridden, the rest of the
   * preset (extra env vars, model rows) is kept. Renaming moves its key and keeps it chosen.
   */
  async saveProvider(draft: ProviderDraft) {
    const app = providerAppOf(draft.app)
    if (!app)
      throw new Error('这个 agent 不能设置服务商')
    const name = draft.name.trim()
    if (!name || name.length > 60)
      throw new Error('服务商名称要有 1 到 60 个字')
    const list = this.store.value.providers ?? []
    const previous = draft.previous ? list.find(item => item.app === app && item.name === draft.previous) : undefined
    if (name !== draft.previous && (list.some(item => item.app === app && item.name === name)))
      throw new Error(`已经有一个叫 ${name} 的服务商`)
    const from = draft.from ? findPreset(app, draft.from) : undefined
    if (draft.from && !from)
      throw new Error(`没有找到 ${draft.from} 这个预设`)
    const base: Preset = structuredClone((previous?.preset as Preset | undefined) ?? from ?? (draft.previous ? findPreset(app, draft.previous) : undefined) ?? { name, official: false, category: 'custom', ...(app === 'claude' ? { keyField: 'ANTHROPIC_AUTH_TOKEN' } : {}), ...(app === 'codex' ? { wireApi: 'responses' } : {}) })
    const baseUrl = draft.baseUrl?.trim() ? providerEndpoint(draft.baseUrl) : undefined
    const model = draft.model?.trim() || undefined
    const fields = envFields[app]
    if (fields) {
      base.env = { ...base.env }
      if (baseUrl)
        base.env[fields.url] = baseUrl
      if (model)
        base.env[fields.model] = model
      if (!base.env[fields.url])
        throw new Error('请填写请求地址')
    }
    else {
      base.baseUrl = baseUrl ?? base.baseUrl
      base.model = model ?? base.model
      if (!base.baseUrl)
        throw new Error('请填写请求地址')
      if (!base.model)
        throw new Error('Codex 需要一个模型名')
    }
    base.name = name
    const source: CustomProvider['source'] = previous?.source ?? (from || (draft.previous && findPreset(app, draft.previous)) ? 'preset' : 'custom')
    const entry = { app, name, source, preset: base } as CustomProvider
    this.store.value.providers = [...list.filter(item => !(item.app === app && (item.name === name || item.name === draft.previous))), entry]
    const keys = await this.allKeys()
    if (draft.previous && draft.previous !== name && keys[`${app}:${draft.previous}`]) {
      keys[`${app}:${name}`] = keys[`${app}:${draft.previous}`]!
      delete keys[`${app}:${draft.previous}`]
      await this.secrets.write(JSON.stringify(keys))
    }
    if (draft.key?.trim())
      await this.saveKey(`${app}:${name}`, draft.key.trim())
    if (draft.previous && this.store.value.agents?.[app]?.provider === draft.previous)
      this.store.value.agents = { ...this.store.value.agents, [app]: { provider: name } }
    await this.store.save()
  }

  /** Remove one of the user's providers and its key; an app that was using it goes back to its own login. */
  async deleteProvider(appName: string, name: string) {
    const app = providerAppOf(appName)
    if (!app)
      throw new Error('这个 agent 不能设置服务商')
    this.store.value.providers = (this.store.value.providers ?? []).filter(item => !(item.app === app && item.name === name))
    if (this.store.value.agents?.[app]?.provider === name)
      this.store.value.agents = { ...this.store.value.agents, [app]: {} }
    const keys = await this.allKeys()
    if (keys[`${app}:${name}`]) {
      delete keys[`${app}:${name}`]
      await this.secrets.write(JSON.stringify(keys))
    }
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
      providers.push({ app: item.app, name: item.name, source: 'imported', preset: item.preset })
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
    const mine: AgentsSnapshot['mine'] = {}
    for (const app of apps) {
      presets[app] = presetsFor(app).map(preset => ({ name: preset.name, category: preset.category, official: preset.official, apiKeyUrl: preset.apiKeyUrl, website: preset.website, ...describe(app, preset) }))
      mine[app] = this.mine(app, keys)
    }
    return {
      detected,
      providers,
      global: { claude: this.switcher.status('claude'), codex: this.switcher.status('codex'), gemini: this.switcher.status('gemini') },
      presets,
      mine,
      ccSwitch: existsSync(this.ccSwitchDb),
    }
  }
}
