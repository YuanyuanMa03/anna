import type { DelegateAgent } from '../agents/adapters'
import type { Listed } from '../agents/aggregate'
import type { LinkImport } from '../agents/deeplink'
import type { AgentInfo } from '../agents/detect'
import type { ImportedProvider, Preset, ProviderApp, ProviderChoice } from '../agents/providers'
import type { RouteHandle } from '../routing/server'
import type { AgentsSnapshot, AgentStatus, CustomProvider, MyProvider, ProviderDraft, RoutingPolicy, UniversalDraft, UniversalProvider } from '../shared/contracts'
import type { SettingsStore } from './settings'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { approvalStyle, verified } from '../agents/adapters'
import { claudePickerRows, codexAggregateCatalog, modelKeyFor } from '../agents/aggregate'
import { catalog } from '../agents/catalog'
import { codexCatalog } from '../agents/codex-catalog'
import { maskKey, parseProviderLink } from '../agents/deeplink'
import { detectAgents } from '../agents/detect'
import { GlobalSwitcher, routedOnlyInAnna } from '../agents/global'
import { nodeEnvironment } from '../agents/node-environment'
import { canRoute, chatReasoningOf, chatRouteOf, findPreset, importCcSwitch, keyFieldOf, presetsFor, providerEnv, routedThroughAnna, upstreamOf } from '../agents/providers'
import { testEndpoints } from '../agents/speedtest'
import { RoutingTakeover } from '../agents/takeover'
import { queryUsage, usageKind } from '../agents/usage'
import { failoverDefaults } from '../routing/breaker'
import { routing, routingIfStarted } from '../routing/server'

export interface SecretVault { read: () => Promise<string>, write: (value: string) => Promise<void> }
export interface AgentsOptions {
  locate?: (agent: DelegateAgent) => { command: string, prefix?: string[] } | undefined
  detect?: () => Promise<AgentInfo[]>
  configDirs?: Record<ProviderApp, string>
  ccSwitchDb?: string
  /** The speed test's HTTP client (tests point it at a local server). */
  fetch?: typeof fetch
  /** Global routing's fixed port (tests use a free one). */
  routingPort?: number
}

/** Global routing's port: next to cc-switch's 15721, so both can run. */
export const globalRoutingPort = 15722
const routedApps = ['claude', 'codex'] as const
/** The failover settings the user can change, and their bounds. */
const policyBounds: Record<keyof RoutingPolicy, [number, number, string]> = { maxRetries: [0, 10, '最多再试几家'], firstByteTimeout: [5, 600, '等第一个字的秒数'], idleTimeout: [10, 1800, '输出中断多久算失败'], failureThreshold: [1, 50, '连续失败几次就暂停'], openSeconds: [5, 3600, '暂停的秒数'] }

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

/** Codex speaks /v1/responses: a bare gateway origin gets /v1, a URL with a path is used as written (cc-switch's rule). */
export function codexBase(url: string) {
  const trimmed = url.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') || new URL(trimmed).pathname !== '/' ? trimmed : `${trimmed}/v1`
}

/** The provider each enabled app gets from a universal one (cc-switch's to_claude/codex/gemini_provider). */
export function universalPresets(universal: UniversalProvider): Partial<Record<ProviderApp, Preset>> {
  const base = { name: universal.name, official: false, category: 'aggregator', website: universal.website }
  const { claude, codex, gemini } = universal.models
  const out: Partial<Record<ProviderApp, Preset>> = {}
  if (universal.apps.claude) {
    const model = claude?.model
    out.claude = { ...base, keyField: 'ANTHROPIC_AUTH_TOKEN', env: { ANTHROPIC_BASE_URL: universal.baseUrl, ...(model ? { ANTHROPIC_MODEL: model } : {}), ...(claude?.haiku ?? model ? { ANTHROPIC_DEFAULT_HAIKU_MODEL: (claude?.haiku ?? model)! } : {}), ...(claude?.sonnet ?? model ? { ANTHROPIC_DEFAULT_SONNET_MODEL: (claude?.sonnet ?? model)! } : {}), ...(claude?.opus ?? model ? { ANTHROPIC_DEFAULT_OPUS_MODEL: (claude?.opus ?? model)! } : {}) } }
  }
  if (universal.apps.codex)
    out.codex = { ...base, baseUrl: codexBase(universal.baseUrl), model: codex?.model, wireApi: 'responses', reasoningEffort: codex?.reasoningEffort }
  if (universal.apps.gemini)
    out.gemini = { ...base, env: { GOOGLE_GEMINI_BASE_URL: universal.baseUrl, ...(gemini?.model ? { GEMINI_MODEL: gemini.model } : {}) } }
  return out
}

/** A candidate origin takes the in-use address's path (`https://b.example` + `/v1`); one with its own path is kept. */
export function withPath(candidate: string, current?: string) {
  const url = new URL(candidate)
  if (url.pathname !== '/' || !current)
    return candidate.replace(/\/+$/, '')
  return `${url.origin}${new URL(current).pathname.replace(/\/+$/, '')}`
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
  private speed: AgentsSnapshot['speed'] = {}
  private usage: AgentsSnapshot['usage'] = {}
  /** A link's provider waiting for confirmation; its key never leaves this process unmasked. */
  private pending?: LinkImport
  readonly switcher: GlobalSwitcher
  readonly takeover: RoutingTakeover
  /** Global routing's open routes, one per agent, and how each one stands. */
  private globalRoutes: Partial<Record<'claude' | 'codex', RouteHandle>> = {}
  private routingStatus: Partial<Record<'claude' | 'codex', { url?: string, error?: string }>> = {}
  constructor(private data: string, private store: SettingsStore, private secrets: SecretVault, private options: AgentsOptions = {}) {
    const home = homedir()
    const dirs = options.configDirs ?? { claude: join(home, '.claude'), codex: join(home, '.codex'), gemini: join(home, '.gemini') }
    this.switcher = new GlobalSwitcher(join(data, 'agent-backups'), dirs)
    this.takeover = new RoutingTakeover(join(data, 'agent-backups'), dirs)
  }

  /** Global routing's token for an agent: kept with the keys, so the CLI's config stays valid across restarts. */
  private async routeToken(app: 'claude' | 'codex') {
    const keys = await this.allKeys()
    if (!keys[`route:${app}`])
      await this.saveKey(`route:${app}`, `anna-route-${randomBytes(24).toString('hex')}`)
    return keys[`route:${app}`]!
  }

  /** Failover settings in force for an agent: the defaults with the user's changes. */
  private policy(app: 'claude' | 'codex'): Required<RoutingPolicy> {
    const { maxRetries, firstByteTimeout, idleTimeout, failureThreshold, openSeconds } = failoverDefaults[app]
    return { maxRetries, firstByteTimeout, idleTimeout, failureThreshold, openSeconds, ...this.store.value.routing?.policies?.[app] }
  }

  async setRoutingPolicy(appName: string, policy: RoutingPolicy) {
    const app = providerAppOf(appName)
    if (app !== 'claude' && app !== 'codex')
      throw new Error('只有 Claude Code 和 Codex 经过 Anna 的路由')
    const clean: RoutingPolicy = {}
    for (const [key, value] of Object.entries(policy) as [keyof RoutingPolicy, unknown][]) {
      const bounds = policyBounds[key]
      if (!bounds)
        continue
      if (typeof value !== 'number' || !Number.isInteger(value) || value < bounds[0] || value > bounds[1])
        throw new Error(`“${bounds[2]}”要是 ${bounds[0]} 到 ${bounds[1]} 之间的整数`)
      clean[key] = value
    }
    const routingSettings = this.store.value.routing ?? {}
    this.store.value.routing = { ...routingSettings, policies: { ...routingSettings.policies, [app]: clean } }
    await this.store.save()
    routingIfStarted()?.configure(app, clean)
  }

  /** Turn global routing on or off for an agent; its config is written (or given back) right away. */
  async setGlobalRouting(appName: string, on: boolean) {
    const app = providerAppOf(appName)
    if (app !== 'claude' && app !== 'codex')
      throw new Error('只有 Claude Code 和 Codex 能经过 Anna 的路由')
    if (on && this.switcher.status(app).switched)
      throw new Error(`Anna 已经把 ${app === 'claude' ? 'Claude Code' : 'Codex'} 的配置直接切到了 ${this.switcher.status(app).provider}，先恢复原配置`)
    const routingSettings = this.store.value.routing ?? {}
    this.store.value.routing = { ...routingSettings, global: { ...routingSettings.global, [app]: on } }
    await this.store.save()
    await this.syncRouting()
    if (on && this.routingStatus[app]?.error)
      throw new Error(this.routingStatus[app]!.error)
  }

  /**
   * Bring global routing in line with the settings and the providers chosen now: the route follows the provider in
   * use and its backups, and the agent's config is (re)written when its view changes. Also run at start, which
   * renews a takeover left by a crash, or gives the config back when routing was switched off.
   */
  async syncRouting() {
    const enabled = this.store.value.routing?.global ?? {}
    const server = enabled.claude || enabled.codex ? await routing() : routingIfStarted()
    for (const app of routedApps) server?.configure(app, this.store.value.routing?.policies?.[app] ?? {})
    for (const app of routedApps) {
      if (!enabled[app]) {
        this.globalRoutes[app]?.close()
        delete this.globalRoutes[app]
        delete this.routingStatus[app]
        if (await this.takeover.active(app))
          await this.takeover.release(app)
        continue
      }
      try {
        const choice = await this.choice(app)
        if (!choice || !canRoute(app, choice.preset))
          throw new Error('先在这里选一个服务商：它自己的登录不能经过 Anna 的路由')
        const base = await server!.listen(this.options.routingPort ?? globalRoutingPort)
        const backups = (await this.backups(app)).filter(backup => canRoute(app, backup.preset))
        const listed = await this.listed(app)
        const spec = { ...chatRouteOf(app, choice), ...(backups.length ? { backups: backups.map(backup => upstreamOf(app, backup)) } : {}), ...(listed.length ? { aggregate: Object.fromEntries(listed.map(({ key, choice }) => [key, upstreamOf(app, choice)])) } : {}) }
        // The provider in use answers to the agent's default model names; it isn't listed a second time.
        const published = listed.filter(item => item.choice.preset.name !== choice.preset.name)
        const token = await this.routeToken(app)
        const handle = this.globalRoutes[app]
        if (handle)
          handle.update(spec)
        else this.globalRoutes[app] = server!.open(spec, token)
        const url = `${base}${app === 'claude' ? '/claude' : '/codex/v1'}`
        if (app === 'claude') {
          await this.takeover.apply({ app, target: { url, token, models: upstreamOf(app, choice).models ?? {}, picker: claudePickerRows(published) } })
        }
        else {
          const catalog = codexAggregateCatalog(codexCatalog(choice.preset, choice.model), published)
          await this.takeover.apply({ app, target: { url, token, model: choice.model ?? choice.preset.model }, ...(catalog ? { catalog: `${JSON.stringify(catalog, null, 2)}\n` } : {}) })
        }
        this.routingStatus[app] = { url }
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.routingStatus[app] = { error: /EADDRINUSE/.test(message) ? `端口 ${this.options.routingPort ?? globalRoutingPort} 被占用了（另一个 Anna 在运行？）` : message }
        // A config pointing at a route that can't answer would only break the CLI: give it back.
        this.globalRoutes[app]?.close()
        delete this.globalRoutes[app]
        if (await this.takeover.active(app))
          await this.takeover.release(app)
      }
    }
  }

  /** On quit: every config Anna holds goes back as it was; the settings stay, so the next start takes over again. */
  async releaseRouting() {
    for (const app of routedApps) {
      this.globalRoutes[app]?.close()
      delete this.globalRoutes[app]
      await this.takeover.release(app)
    }
  }

  /** The providers listed in the agent's own model list, with their keys; any that Anna can't route are left out. */
  private async listed(app: 'claude' | 'codex'): Promise<Listed[]> {
    const routingSettings = this.store.value.routing
    const keyOf = Object.fromEntries(Object.entries(routingSettings?.keys?.[app] ?? {}).flatMap(([key, name]) => name ? [[name, key]] : []))
    const keys = await this.allKeys()
    return (routingSettings?.aggregate?.[app] ?? []).flatMap((name) => {
      const preset = this.preset(app, name)
      return preset && keyOf[name] && canRoute(app, preset) ? [{ key: keyOf[name], choice: { preset, key: keys[`${app}:${name}`] } }] : []
    })
  }

  /**
   * Which other providers' models join the agent's own model list under global routing, in order. Each provider gets
   * its key the first time and keeps it for good.
   */
  async setAggregate(appName: string, names: string[]) {
    const app = providerAppOf(appName)
    if (app !== 'claude' && app !== 'codex')
      throw new Error('只有 Claude Code 和 Codex 能把别的服务商列进模型列表')
    for (const name of names) {
      const preset = this.preset(app, name)
      if (!preset)
        throw new Error(`没有找到 ${name} 这个服务商`)
      if (!canRoute(app, preset))
        throw new Error(`${name} 用的是它自己的登录，不能列进模型列表`)
    }
    const list = [...new Set(names)]
    const routingSettings = this.store.value.routing ?? {}
    const registry = { ...routingSettings.keys?.[app] }
    for (const name of list) {
      if (!Object.values(registry).includes(name))
        registry[modelKeyFor(name, Object.keys(registry))] = name
    }
    this.store.value.routing = { ...routingSettings, aggregate: { ...routingSettings.aggregate, [app]: list }, keys: { ...routingSettings.keys, [app]: registry } }
    await this.store.save()
    await this.syncRouting()
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

  /** The provider in use and its backups for one agent; the one in use is never its own backup. */
  private setAgent(agent: string, next: { provider?: string, backups?: string[] }) {
    const merged = { ...this.store.value.agents?.[agent], ...next }
    const backups = [...new Set(merged.backups ?? [])].filter(name => name !== merged.provider)
    this.store.value.agents = { ...this.store.value.agents, [agent]: { ...(merged.provider ? { provider: merged.provider } : {}), ...(backups.length ? { backups } : {}) } }
  }

  /** A provider renamed (or, without `to`, gone): in use, among the backups and in the model list alike. */
  private renameChosen(agent: string, from: string, to?: string) {
    const routingSettings = this.store.value.routing
    if ((agent === 'claude' || agent === 'codex') && (routingSettings?.aggregate?.[agent] || routingSettings?.keys?.[agent])) {
      // Its model key stays with it; a deleted provider's stays reserved, so ids an agent remembers fail rather than move.
      const list = (routingSettings.aggregate?.[agent] ?? []).flatMap(name => name !== from ? [name] : to ? [to] : [])
      const registry = Object.fromEntries(Object.entries(routingSettings.keys?.[agent] ?? {}).map(([key, name]) => [key, name === from ? to ?? null : name]))
      this.store.value.routing = { ...routingSettings, aggregate: { ...routingSettings.aggregate, [agent]: list }, keys: { ...routingSettings.keys, [agent]: registry } }
    }
    const current = this.store.value.agents?.[agent]
    if (!current)
      return
    const swap = (value?: string) => value === from ? to : value
    this.store.value.agents = { ...this.store.value.agents, [agent]: {} }
    this.setAgent(agent, { provider: swap(current.provider), backups: (current.backups ?? []).map(swap).filter((name): name is string => Boolean(name)) })
  }

  /** Providers to fall back on, in order, for a run that uses `primary` (by default the one in use). */
  async backups(agent: string, primary?: string): Promise<ProviderChoice[]> {
    const app = providerAppOf(agent)
    if (!app)
      return []
    const chosen = primary ?? this.store.value.agents?.[agent]?.provider
    const keys = await this.allKeys()
    return (this.store.value.agents?.[agent]?.backups ?? []).filter(name => name !== chosen).flatMap((name) => {
      const preset = this.preset(app, name)
      return preset ? [{ preset, key: keys[`${app}:${name}`] }] : []
    })
  }

  /** The backup queue for Claude Code or Codex, in order. Their own login can't be a backup: Anna can't route it. */
  async setBackups(agent: string, names: string[]) {
    const app = providerAppOf(agent)
    if (app !== 'claude' && app !== 'codex')
      throw new Error('只有 Claude Code 和 Codex 能设置备用服务商')
    for (const name of names) {
      const preset = this.preset(app, name)
      if (!preset)
        throw new Error(`没有找到 ${name} 这个服务商`)
      if (!canRoute(app, preset))
        throw new Error(`${name} 用的是它自己的登录，不能当备用`)
    }
    this.setAgent(agent, { backups: names })
    await this.store.save()
  }

  async setProvider(agent: string, provider?: string, key?: string) {
    const app = providerAppOf(agent)
    if (!app)
      throw new Error('这个 agent 暂不支持切换服务商')
    if (provider && !this.preset(app, provider))
      throw new Error(`没有找到 ${provider} 这个服务商`)
    if (provider && key)
      await this.saveKey(`${app}:${provider}`, key.trim())
    this.setAgent(agent, { provider })
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
    return entries.map(({ name, source, preset }) => ({ name, source, category: preset.category, ...describe(app, preset), website: preset.website, apiKeyUrl: preset.apiKeyUrl, hasKey: Boolean(keys[`${app}:${name}`]), usage: usageKind(describe(app, preset).baseUrl), ...(routedThroughAnna(app, preset) ? { routed: true } : {}) }))
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
    if (previous?.source === 'universal')
      throw new Error(`${previous.name} 来自统一服务商，请在“统一”里修改`)
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
    // Claude Code and Codex can reach a Chat Completions provider through Anna's routing.
    if (app !== 'gemini' && draft.apiFormat === 'openai_chat')
      base.apiFormat = 'openai_chat'
    else if (draft.apiFormat)
      delete base.apiFormat
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
    if (draft.previous && draft.previous !== name)
      this.renameChosen(app, draft.previous, name)
    await this.store.save()
  }

  /**
   * Add or edit a universal provider: one key, stored once and copied to each enabled app's linked provider. An app
   * switched off loses its linked provider (and goes back to its own login if it was using it).
   */
  async saveUniversal(draft: UniversalDraft) {
    const name = draft.name.trim()
    if (!name || name.length > 60)
      throw new Error('服务商名称要有 1 到 60 个字')
    const list = this.store.value.universal ?? []
    if (name !== draft.previous && list.some(item => item.name === name))
      throw new Error(`已经有一个叫 ${name} 的统一服务商`)
    if (!draft.apps.claude && !draft.apps.codex && !draft.apps.gemini)
      throw new Error('至少要用在一个 agent 上')
    if (draft.apps.codex && !draft.models.codex?.model?.trim())
      throw new Error('Codex 需要一个模型名')
    const trim = (value?: string) => value?.trim() || undefined
    const universal: UniversalProvider = {
      name,
      baseUrl: providerEndpoint(draft.baseUrl),
      apps: { claude: Boolean(draft.apps.claude), codex: Boolean(draft.apps.codex), gemini: Boolean(draft.apps.gemini) },
      models: {
        claude: { model: trim(draft.models.claude?.model), haiku: trim(draft.models.claude?.haiku), sonnet: trim(draft.models.claude?.sonnet), opus: trim(draft.models.claude?.opus) },
        codex: { model: trim(draft.models.codex?.model), reasoningEffort: trim(draft.models.codex?.reasoningEffort) },
        gemini: { model: trim(draft.models.gemini?.model) },
      },
      website: trim(draft.website),
    }
    const presets = universalPresets(universal)
    if ((this.store.value.providers ?? []).some(item => item.source !== 'universal' && item.name === name && presets[item.app]))
      throw new Error(`${name} 和你已有的一个服务商重名，换个名字`)
    const old = draft.previous ? list.find(item => item.name === draft.previous) : undefined
    const keys = await this.allKeys()
    const key = draft.key?.trim() || (old ? keys[`universal:${old.name}`] : undefined)
    // Linked providers of the old entry go; this entry's come back for each enabled app, with the shared key.
    const linked = (item: CustomProvider) => item.source === 'universal' && (item.name === draft.previous || item.name === name)
    for (const app of apps) {
      if (old && keys[`${app}:${old.name}`])
        delete keys[`${app}:${old.name}`]
      if (old)
        this.renameChosen(app, old.name, universal.apps[app] ? name : undefined)
    }
    if (old)
      delete keys[`universal:${old.name}`]
    this.store.value.providers = [...(this.store.value.providers ?? []).filter(item => !linked(item)), ...apps.flatMap(app => presets[app] ? [{ app, name, source: 'universal' as const, preset: presets[app]! } as CustomProvider] : [])]
    if (key) {
      keys[`universal:${name}`] = key
      for (const app of apps) {
        if (presets[app])
          keys[`${app}:${name}`] = key
      }
    }
    await this.secrets.write(JSON.stringify(keys))
    this.store.value.universal = [...list.filter(item => item.name !== draft.previous && item.name !== name), universal]
    await this.store.save()
  }

  /** Remove a universal provider, its linked providers and its key. */
  async deleteUniversal(name: string) {
    this.store.value.universal = (this.store.value.universal ?? []).filter(item => item.name !== name)
    for (const app of apps) {
      if ((this.store.value.providers ?? []).some(item => item.app === app && item.name === name && item.source === 'universal'))
        await this.deleteProvider(app, name)
    }
    const keys = await this.allKeys()
    delete keys[`universal:${name}`]
    await this.secrets.write(JSON.stringify(keys))
    await this.store.save()
  }

  /** Time the provider's address and its preset's other addresses (with the same path), fastest first. */
  async speedtest(appName: string, name: string, fetcher?: typeof fetch) {
    const app = providerAppOf(appName)
    const preset = app && this.preset(app, name)
    if (!app || !preset)
      throw new Error(`没有找到 ${name} 这个服务商`)
    const current = describe(app, preset).baseUrl
    const origin = findPreset(app, preset.name) ?? preset
    const candidates = [...new Set([current, ...(preset.endpoints ?? origin.endpoints ?? [])].filter((url): url is string => Boolean(url)).map(url => withPath(url, current)))]
    if (!candidates.length)
      throw new Error('这个服务商没有可测的地址')
    const results = await testEndpoints(candidates, { fetch: this.options.fetch ?? fetcher })
    results.sort((a, b) => (a.latency ?? Infinity) - (b.latency ?? Infinity))
    this.speed[`${app}:${name}`] = { at: new Date().toISOString(), results }
  }

  /** Look up what's left on the provider's account (balance or Coding Plan quota) with its saved key. */
  async checkUsage(appName: string, name: string) {
    const app = providerAppOf(appName)
    const preset = app && this.preset(app, name)
    const baseUrl = app && preset ? describe(app, preset).baseUrl : undefined
    if (!app || !baseUrl || !usageKind(baseUrl))
      throw new Error('还不支持查询这个服务商的余额')
    const key = (await this.allKeys())[`${app}:${name}`] ?? ''
    this.usage[`${app}:${name}`] = { at: new Date().toISOString(), ...await queryUsage(baseUrl, key, { fetch: this.options.fetch }) }
  }

  /** Read an import link and hold its provider for the user to confirm. */
  previewLink(link: string) {
    const parsed = parseProviderLink(link)
    providerEndpoint(parsed.baseUrl)
    this.pending = { ...parsed, warnings: [...parsed.warnings, ...(parsed.app === 'codex' && !parsed.model ? ['没有指定模型，Codex 会用它自己的默认模型'] : [])] }
  }

  cancelLink() { this.pending = undefined }

  /** Add the confirmed link's provider (a free name if it's taken), with its key; optionally start using it. */
  async confirmLink(use: boolean) {
    const link = this.pending
    if (!link)
      throw new Error('没有待导入的链接')
    const { app } = link
    const taken = new Set((this.store.value.providers ?? []).filter(item => item.app === app).map(item => item.name))
    let name = link.name
    for (let index = 2; taken.has(name); index++) name = `${link.name} ${index}`
    const base = { name, official: false, category: 'third_party', website: link.website, endpoints: link.endpoints.length ? [link.baseUrl, ...link.endpoints] : undefined }
    const preset: Preset = app === 'claude'
      ? { ...base, keyField: 'ANTHROPIC_AUTH_TOKEN', ...(link.apiFormat ? { apiFormat: link.apiFormat } : {}), env: { ...link.env, ANTHROPIC_BASE_URL: link.baseUrl, ...(link.model ? { ANTHROPIC_MODEL: link.model } : {}), ...(link.tiers?.haiku ? { ANTHROPIC_DEFAULT_HAIKU_MODEL: link.tiers.haiku } : {}), ...(link.tiers?.sonnet ? { ANTHROPIC_DEFAULT_SONNET_MODEL: link.tiers.sonnet } : {}), ...(link.tiers?.opus ? { ANTHROPIC_DEFAULT_OPUS_MODEL: link.tiers.opus } : {}) } }
      : app === 'gemini'
        ? { ...base, env: { GOOGLE_GEMINI_BASE_URL: link.baseUrl, ...(link.model ? { GEMINI_MODEL: link.model } : {}) } }
        : { ...base, baseUrl: link.baseUrl, model: link.model, wireApi: 'responses', ...(link.apiFormat ? { apiFormat: link.apiFormat } : {}) }
    this.store.value.providers = [...(this.store.value.providers ?? []), { app, name, source: 'custom', preset } as CustomProvider]
    if (use)
      this.setAgent(app, { provider: name })
    await this.saveKey(`${app}:${name}`, link.key)
    await this.store.save()
    this.pending = undefined
    return name
  }

  /**
   * Write the user's providers and universal providers to a file Anna (or another machine's Anna) can import. Keys
   * only when asked for, and then the file is readable by its owner alone.
   */
  async exportTo(path: string, includeKeys: boolean) {
    const providers = (this.store.value.providers ?? []).filter(item => item.source !== 'universal')
    const universal = this.store.value.universal ?? []
    const all = await this.allKeys()
    const names = [...providers.map(item => `${item.app}:${item.name}`), ...universal.map(item => `universal:${item.name}`)]
    const keys = includeKeys ? Object.fromEntries(names.filter(name => all[name]).map(name => [name, all[name]!])) : undefined
    await writeFile(path, `${JSON.stringify({ format: 'anna-providers', version: 1, exportedAt: new Date().toISOString(), providers, universal, ...(keys ? { keys } : {}) }, null, 2)}\n`, { mode: 0o600 })
    return providers.length + universal.length
  }

  /** Bring providers in from an exported file: names already taken get a number; keys come along when the file has them. */
  async importFrom(path: string) {
    let file: { format?: string, version?: number, providers?: CustomProvider[], universal?: UniversalProvider[], keys?: Record<string, string> }
    try { file = JSON.parse(await readFile(path, 'utf8')) }
    catch { throw new Error('这个文件不是有效的 JSON') }
    if (!file || typeof file !== 'object' || file.format !== 'anna-providers' || file.version !== 1)
      throw new Error('这不是 Anna 导出的服务商文件')
    const keys = file.keys ?? {}
    let count = 0
    for (const universal of file.universal ?? []) {
      const taken = new Set((this.store.value.universal ?? []).map(item => item.name))
      let name = universal.name
      for (let index = 2; taken.has(name); index++) name = `${universal.name} ${index}`
      await this.saveUniversal({ ...universal, name, key: keys[`universal:${universal.name}`] })
      count++
    }
    const list = [...(this.store.value.providers ?? [])]
    for (const item of file.providers ?? []) {
      if (!item || !apps.includes(item.app) || typeof item.name !== 'string' || !item.name.trim() || !item.preset || typeof item.preset !== 'object' || item.source === 'universal')
        continue
      const fields = envFields[item.app]
      const url = fields ? item.preset.env?.[fields.url] : item.preset.baseUrl
      if (!url)
        continue
      providerEndpoint(url)
      const wanted = item.name.trim().slice(0, 60)
      let name = wanted
      for (let index = 2; list.some(entry => entry.app === item.app && entry.name === name); index++) name = `${wanted} ${index}`
      // Same rules as for links and launches: no loader env vars, the key only in Claude Code's own key variables.
      const preset = { ...item.preset, name, ...(item.preset.env ? { env: providerEnv(item.preset as Preset) } : {}), ...(item.app === 'claude' ? { keyField: keyFieldOf(item.preset as Preset) } : {}), ...(item.app !== 'gemini' ? { apiFormat: item.preset.apiFormat === 'openai_chat' ? 'openai_chat' : undefined } : {}), ...(item.app === 'codex' ? { chatReasoning: chatReasoningOf(item.preset.chatReasoning) } : {}) }
      list.push({ app: item.app, name, source: item.source === 'imported' ? 'imported' : item.source === 'custom' ? 'custom' : 'preset', preset } as CustomProvider)
      if (keys[`${item.app}:${item.name}`])
        await this.saveKey(`${item.app}:${name}`, keys[`${item.app}:${item.name}`]!)
      count++
    }
    this.store.value.providers = list
    await this.store.save()
    return count
  }

  /** Remove one of the user's providers and its key; an app that was using it goes back to its own login. */
  async deleteProvider(appName: string, name: string) {
    const app = providerAppOf(appName)
    if (!app)
      throw new Error('这个 agent 不能设置服务商')
    this.store.value.providers = (this.store.value.providers ?? []).filter(item => !(item.app === app && item.name === name))
    this.renameChosen(app, name)
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
    if (routedThroughAnna(app, choice.preset))
      throw new Error(routedOnlyInAnna(choice.preset.name))
    if ((app === 'claude' || app === 'codex') && this.store.value.routing?.global?.[app])
      throw new Error('它在终端里正经过 Anna 的路由，先关掉“终端也走 Anna 的路由”')
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
      const { provider, backups } = this.store.value.agents?.[agent] ?? {}
      const aggregate = agent === 'gemini' ? undefined : this.store.value.routing?.aggregate?.[agent as 'claude' | 'codex']
      providers[agent] = { provider, hasKey: Boolean(provider && keys[`${agent}:${provider}`]), ...(backups?.length ? { backups } : {}), ...(aggregate?.length ? { aggregate } : {}) }
    }
    const presets: AgentsSnapshot['presets'] = {}
    const mine: AgentsSnapshot['mine'] = {}
    for (const app of apps) {
      presets[app] = presetsFor(app).map(preset => ({ name: preset.name, category: preset.category, official: preset.official, apiKeyUrl: preset.apiKeyUrl, website: preset.website, ...describe(app, preset), ...(routedThroughAnna(app, preset) ? { routed: true } : {}) }))
      // Health only once a run has started the routing service; until then every breaker is closed.
      const health = routingIfStarted()?.health() ?? {}
      mine[app] = this.mine(app, keys).map((item) => {
        const state = app === 'gemini' ? undefined : health[`${app}:${item.name}`]?.state
        return state && state !== 'closed' ? { ...item, health: state } : item
      })
    }
    return {
      detected,
      providers,
      global: { claude: { ...this.switcher.status('claude'), ...(this.routingStatus.claude ? { routing: this.routingStatus.claude } : {}) }, codex: { ...this.switcher.status('codex'), ...(this.routingStatus.codex ? { routing: this.routingStatus.codex } : {}) }, gemini: this.switcher.status('gemini') },
      routingPolicies: { claude: this.policy('claude'), codex: this.policy('codex') },
      presets,
      mine,
      speed: this.speed,
      usage: this.usage,
      pendingImport: this.pending && { ...this.pending, key: maskKey(this.pending.key) },
      universal: (this.store.value.universal ?? []).map(item => ({ ...item, hasKey: Boolean(keys[`universal:${item.name}`]) })),
      ccSwitch: existsSync(this.ccSwitchDb),
    }
  }
}
