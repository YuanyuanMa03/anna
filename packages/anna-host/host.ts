import type { DelegateAgent } from '../agents/adapters'
import type { AgentKernel, AnnaTool, GateVerdict, KernelFactory } from '../kernels/types'
import type { PermissionMode } from '../permissions/modes'
import type { RuleSet } from '../permissions/rules'
import type { SandboxStatus } from '../permissions/sandbox'
import type { AgentsSnapshot, AnnaEvent, ApprovalQuestion, Command, Message, Origin, PlatformInfo, RuntimeSnapshot, TaskResult, WorkspaceSettings } from '../shared/contracts'
import type { AgentsOptions, SecretVault } from './agents-hub'
import type { DelegationOutcome } from './delegator'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { characters, companion } from '../character/manifest'
import { kernels } from '../kernels/registry'
import { decide } from '../permissions/engine'
import { modes, stricter, trustedRegistries } from '../permissions/modes'
import { canonical, resolveToolPath } from '../permissions/paths'
import { emptyRules, evaluateRules, mergeRules } from '../permissions/rules'
import { CommandSandbox } from '../permissions/sandbox'
import { AgentsHub } from './agents-hub'
import { ApprovalBroker } from './approval-broker'
import { Checkpoints } from './checkpoints'
import { delegateAgents, Delegator, labelOf, parseMention } from './delegator'
import { TaskJournal } from './journal'
import { MemoryStore } from './memory'
import { describeModelError } from './model-errors'
import { Presence } from './presence'
import { SettingsStore, validateModel } from './settings'

export interface CredentialVault { read: () => Promise<string>, write: (key: string) => Promise<void> }
/** A remote channel (Weixin today) that can push text to its owner outside a reply. */
export interface Channel { notify: (text: string) => Promise<boolean> }
interface Task { id: string, text: string, origin: Origin, resolve: (text: string) => void, reject: (error: Error) => void, delegate?: { agent: DelegateAgent, provider?: string, task: string }, /** Agents that did part of the work. */ collaborators?: Set<string>, /** The user pressed stop. */ stopped?: boolean, /** The companion is checking a collaborator's result. */ reviewing?: boolean }
export interface HostOptions {
  kernel?: KernelFactory
  sandbox?: SandboxStatus
  /** External agents: detection, locations and config dirs (tests point these at fakes). */
  agents?: AgentsOptions
  /** Encrypted store for provider keys (one JSON secret). */
  secrets?: SecretVault
  /** How the OS stores secrets on this machine. */
  secretsMode?: () => Promise<'system' | 'file'>
}

/**
 * One host owns one kernel, one serial task queue, and the permission policy around it.
 * Desktop and remote channels feed the same queue; the kernel never sees credentials beyond its model key.
 */
export class Host {
  private kernel?: AgentKernel
  private approvals: ApprovalBroker
  private presence: Presence
  private checkpoints: Checkpoints
  private memory: MemoryStore
  private journal: TaskJournal
  /** Set when the provider rejected the key in this run; cleared by the next successful turn or a new key. */
  private keyRejected = false
  private sandbox = new CommandSandbox()
  private sandboxStatus: SandboxStatus = { available: false, reason: '尚未检测' }
  private state: RuntimeSnapshot['state'] = 'stopped'
  private error?: string
  private messages: Message[] = []
  private historyDirty = true
  private hasKey = false
  private mutating = false
  /** Reconfiguration commands run one after another instead of failing when they overlap. */
  private mutations: Promise<unknown> = Promise.resolve()
  private tasks: Task[] = []
  private current?: Task
  private sessionRules: string[] = []
  private notedMode?: PermissionMode
  private result?: TaskResult
  private delegator: Delegator
  private hub: AgentsHub
  private agentsCache: AgentsSnapshot = { detected: [], providers: {}, global: {}, presets: {}, mine: {}, universal: [], speed: {}, usage: {}, ccSwitch: false }
  private secretsMode: 'system' | 'file' = 'system'
  readonly channels = new Map<Origin, Channel>()
  readonly store: SettingsStore
  constructor(readonly root: string, readonly data: string, private vault: CredentialVault, private emit: (event: AnnaEvent) => void, private options: HostOptions = {}) {
    this.store = new SettingsStore(data)
    this.checkpoints = new Checkpoints(join(data, 'checkpoints'))
    this.memory = new MemoryStore(data)
    this.journal = new TaskJournal(data)
    this.presence = new Presence((output) => {
      if (output.type === 'anna')
        this.emit({ type: 'anna', state: output.state })
      else if (output.type === 'stream')
        this.emit({ type: 'stream', text: output.text })
      else
        this.emit({ type: 'tool', ...output.activity })
    })
    let memorySecret = ''
    this.hub = new AgentsHub(data, this.store, options.secrets ?? { read: async () => memorySecret, write: async (value) => { memorySecret = value } }, options.agents)
    this.delegator = new Delegator({
      data,
      workspace: () => this.workspacePath,
      mode: origin => this.effectiveMode(origin),
      gate: (tool, input) => this.gate(tool, input),
      escalate: question => this.escalate(question),
      handle: event => this.presence.handle(event),
      supervise: (supervision) => {
        this.presence.supervising = supervision
        if (supervision)
          this.presence.set('supervising', `看着 ${supervision.label} 干活`)
      },
      steps: () => this.presence.stats.step,
      checkpoints: this.checkpoints,
      emit: event => this.emit(event),
      locate: agent => this.hub.locate(agent),
      provider: (agent, name) => this.hub.choice(agent, name),
      denyPaths: () => this.protectedPaths(),
    })
    this.approvals = new ApprovalBroker((question) => {
      this.publish()
      if (question)
        this.announceApproval(question)
    })
  }

  async initialize() {
    await this.store.load()
    await this.store.character()
    await this.memory.load()
    await this.journal.load()
    // 0.3.0 kept a separate UI transcript; the kernel session is now the only record. Keep the old file for reference.
    if (existsSync(join(this.data, 'transcript.json')))
      await rename(join(this.data, 'transcript.json'), join(this.data, 'transcript.legacy.json')).catch(() => {})
    this.hasKey = Boolean(await this.vault.read())
    this.sandboxStatus = this.options.sandbox ?? await CommandSandbox.probe()
    this.state = this.canConnect(this.hasKey ? 'key' : '') ? 'stopped' : 'unconfigured'
    this.secretsMode = await this.options.secretsMode?.().catch(() => 'system' as const) ?? 'system'
    await this.refreshAgents(false)
    this.publish()
    // Detection runs CLIs (--version, login status); never block startup on it.
    void this.refreshAgents(true).catch(() => {})
  }

  private async refreshAgents(detect: boolean) {
    if (detect)
      await this.hub.refresh()
    this.agentsCache = await this.hub.snapshot()
    this.publish()
  }

  get busy() { return Boolean(this.current) }
  get pending() { return this.tasks.length }
  get workspacePath() { return this.store.value.workspace ?? join(this.data, 'workspace') }
  private get isDefaultWorkspace() { return !this.store.value.workspace }

  /** Settings for the current workspace. Anna's own default workspace is trusted; unknown folders start untrusted. */
  workspaceSettings(): WorkspaceSettings & { known: boolean } {
    const saved = this.store.value.workspaces[this.workspacePath]
    if (saved)
      return { ...saved, known: true }
    return this.isDefaultWorkspace ? { trusted: true, mode: 'edit', rules: emptyRules(), known: true } : { trusted: false, mode: 'ask', rules: emptyRules(), known: false }
  }

  /** The mode actually enforced: untrusted folders and remote channels never go beyond `ask`. */
  effectiveMode(origin: Origin = this.current?.origin ?? 'desktop'): PermissionMode {
    const ws = this.workspaceSettings()
    let mode = ws.mode
    if (!ws.trusted)
      mode = stricter(mode, 'ask')
    if (origin !== 'desktop')
      mode = stricter(mode, 'ask')
    return mode
  }

  private platform(): PlatformInfo {
    return { os: process.platform, shell: process.platform === 'win32' ? 'powershell' : 'bash', sandbox: this.sandboxStatus, secrets: this.secretsMode }
  }

  snapshot(full = true): RuntimeSnapshot {
    const ws = this.workspaceSettings()
    const includeMessages = full || this.historyDirty
    this.historyDirty = false
    return {
      state: this.state,
      error: this.error,
      plugins: this.kernel?.plugins ?? [],
      tools: this.kernel?.tools ?? [],
      sessionId: this.kernel?.sessionId || undefined,
      restored: this.kernel?.restored ?? false,
      settings: structuredClone(this.store.value),
      hasKey: this.hasKey,
      messages: includeMessages ? [...this.messages] : undefined,
      approvals: this.approvals.questions,
      anna: this.presence.state,
      queue: this.tasks.map(task => task.text),
      result: this.result,
      model: this.kernel?.modelInfo,
      kernel: { id: this.store.value.kernel, label: kernels[this.store.value.kernel].label },
      credential: this.store.value.kernel !== 'pi' ? undefined : this.keyRejected ? 'rejected' : this.store.value.modelVerified ? 'verified' : 'unverified',
      mode: this.effectiveMode('desktop'),
      workspace: { path: this.workspacePath, trusted: ws.trusted, rules: ws.rules, known: ws.known },
      sessionRules: [...this.sessionRules],
      platform: this.platform(),
      memories: [...this.memory.items],
      agents: this.agentsCache,
    }
  }

  private publish() { this.emit({ type: 'snapshot', snapshot: this.snapshot(false) }) }
  private refreshHistory() {
    const pending = this.current && !this.kernel?.history().some(message => message.role === 'user' && message.text === this.current!.text) ? [{ role: 'user' as const, text: this.current.text, origin: this.current.origin }] : []
    this.messages = [...(this.kernel?.history() ?? []), ...pending]
    this.historyDirty = true
  }

  private safeError(error: unknown, key: string) { const text = error instanceof Error ? error.message : String(error); return key ? text.split(key).join('[REDACTED]') : text }

  // ── Permission gate ─────────────────────────────────────────────────────────

  private protectedPaths() {
    return ['credential.bin', 'weixin-credential.bin', 'providers.bin', 'pi-agent', 'pi-sessions', 'electron', 'settings.json', 'memory.json', 'journal.json', 'delegations.json', 'checkpoints', 'external-sessions'].map(name => join(this.data, name))
  }

  private policyContext(origin: Origin) {
    const ws = this.workspaceSettings()
    return { mode: this.effectiveMode(origin), workspace: canonical(this.workspacePath), sandboxed: this.sandboxStatus.available, rules: mergeRules(ws.rules, { allow: this.sessionRules, ask: [], deny: [] }), protectedPaths: this.protectedPaths().map(path => canonical(path)) }
  }

  private async saveRule(rule: string) {
    const path = this.workspacePath
    const ws = this.workspaceSettings()
    if (!ws.rules.allow.includes(rule))
      ws.rules.allow.push(rule)
    this.store.value.workspaces[path] = { trusted: ws.trusted, mode: ws.mode, rules: ws.rules }
    await this.store.save()
  }

  /** Ask the user, show Anna waiting, and remember wider grants. Returns true when allowed. */
  private async escalate(question: Omit<ApprovalQuestion, 'id' | 'origin'>) {
    const origin = this.current?.origin ?? 'desktop'
    this.presence.wait(question.reason)
    const outcome = await this.approvals.ask({ ...question, origin })
    this.presence.resume()
    if (outcome === 'allowed-session' && question.rule)
      this.sessionRules.push(question.rule)
    if (outcome === 'allowed-always' && question.rule)
      await this.saveRule(question.rule)
    this.publish()
    return outcome === 'cancelled' ? 'cancelled' : outcome.startsWith('allowed') ? 'allowed' : 'rejected'
  }

  private async gate(tool: string, input: Record<string, unknown>): Promise<GateVerdict> {
    const origin = this.current?.origin ?? 'desktop'
    if (this.current?.reviewing && (tool === 'write' || tool === 'edit'))
      return { allow: false, reason: '现在是在审阅协作者的结果：只检查，不修改文件。需要改的地方告诉用户，由用户决定。' }
    const decision = decide(tool, input, this.policyContext(origin))
    if (decision.kind === 'deny')
      return { allow: false, reason: decision.reason }
    // A review for a remote channel never sends approval cards; it checks what it can without them.
    if (decision.kind === 'ask' && this.current?.reviewing && origin !== 'desktop')
      return { allow: false, reason: '这次审阅来自微信，不向用户请求确认：这一步需要确认，所以不做。用不需要确认的方式检查，并说明哪些没能核实。' }
    if (decision.kind === 'ask') {
      const outcome = await this.escalate({ toolName: tool, reason: decision.reason, details: decision.details, danger: decision.danger, rule: decision.rule })
      if (outcome !== 'allowed')
        return { allow: false, reason: outcome === 'cancelled' ? '用户中断了这次任务。' : '用户在确认卡上拒绝了这次操作，这是用户本人的决定。不要换个写法、拆开命令或换个工具再试，也不要建议用户怎样更容易被放行；说明不做这一步的影响，再问用户想怎么做。', stop: outcome === 'cancelled' }
    }
    if ((tool === 'write' || tool === 'edit') && this.current && typeof input.path === 'string') {
      const path = resolveToolPath(input.path, this.workspacePath)
      await this.checkpoints.capture(this.current.id, this.workspacePath, path).catch(() => {})
      this.presence.changed(path)
    }
    return { allow: true }
  }

  /** Every network host a sandboxed command contacts comes here. */
  private async askNetwork(host: string, port: number | undefined) {
    const origin = this.current?.origin ?? 'desktop'
    const mode = this.effectiveMode(origin)
    const ruled = evaluateRules(this.policyContext(origin).rules, 'Network', host, this.workspacePath)
    if (ruled === 'deny' || mode === 'plan')
      return false
    if (ruled === 'allow' || (mode === 'auto' && trustedRegistries.includes(host)))
      return true
    const outcome = await this.escalate({ toolName: 'network', reason: `联网访问 ${host}`, details: `${host}${port ? `:${port}` : ''}`, danger: false, rule: `Network(${host})` })
    return outcome === 'allowed'
  }

  private announceApproval(question: ApprovalQuestion) {
    this.emit({ type: 'notify', title: `${this.companionName} 需要你确认`, body: `${question.reason}：${question.details.slice(0, 120)}` })
    const channel = this.channels.get(question.origin)
    if (channel) {
      const body = question.danger
        ? `${this.companionName} 需要你确认一个高风险操作（${question.reason}）：\n${question.details}\n请回到 Anna 桌面端处理。`
        : `${this.companionName} 需要你确认（${question.reason}）：\n${question.details}\n回复 1 允许，0 拒绝。`
      void channel.notify(body)
    }
  }

  // ── Kernel lifecycle ────────────────────────────────────────────────────────

  /** Anna can hand work to an external agent herself; in plan/ask mode she asks first. */
  private delegateTool(): AnnaTool {
    return {
      name: 'anna_delegate',
      label: '交给其他 agent',
      description: `把一个具体的编码任务交给另一个 coding agent 完成，并取回它的结果。可选 agent：${delegateAgents.join('、')}（claude=Claude Code，codex=Codex）。适合需要大量改代码、或用户点名某个 agent 的时候。task 要写清楚目标和验收标准。`,
      parameters: { type: 'object', properties: { agent: { type: 'string', enum: delegateAgents }, task: { type: 'string' } }, required: ['agent', 'task'] },
      execute: async (args) => {
        const agent = String(args.agent) as DelegateAgent
        const task = String(args.task ?? '').trim()
        if (!delegateAgents.includes(agent) || !task)
          return '参数无效：需要 agent 和 task。'
        const current = this.current
        if (!current)
          return '当前没有进行中的任务。'
        const mode = this.effectiveMode(current.origin)
        if (mode === 'plan' || mode === 'ask') {
          const outcome = await this.escalate({ toolName: 'anna_delegate', reason: `Anna 想让 ${labelOf(agent)} 来处理这件事`, details: task.slice(0, 600), danger: false })
          if (outcome !== 'allowed')
            return `用户没有同意交给 ${labelOf(agent)}。请自己处理，或询问用户。`
        }
        ;(current.collaborators ??= new Set()).add(labelOf(agent))
        const outcome = await this.delegator.run(agent, task, { taskId: current.id, origin: current.origin })
        this.kernel?.remember('delegation', { task, text: outcome.text, origin: current.origin, delegation: outcome.delegation, nested: true })
        return `[${labelOf(agent)} 的结果，状态：${outcome.status}]\n${outcome.text}`
      },
    }
  }

  private tools(): AnnaTool[] {
    const tools: AnnaTool[] = []
    if (this.store.value.statusEnabled)
      tools.push(this.statusTool())
    if (this.store.value.memoryEnabled)
      tools.push(this.memory.tool(() => this.publish()))
    tools.push(this.delegateTool())
    tools.push(this.providersTool())
    return tools
  }

  /**
   * The companion works the providers panel too: reading, balances and speed tests freely; which provider an agent
   * uses, a global switch and a restore only after the user says yes on a card (a global switch, which rewrites the
   * agent's own config, one at a time). Keys never reach the model, and adding or deleting providers stays in the UI.
   */
  private providersTool(): AnnaTool {
    const labels: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' }
    return {
      name: 'anna_providers',
      label: '服务商',
      description: '查看和切换 Claude Code、Codex、Gemini CLI 用的模型服务商（像 cc-switch）。action=list 列出每个 agent 的服务商和正在用的；balance 查某个服务商的余额或额度（app、name）；speedtest 测它的地址延迟（app、name）；use 让派活和当大脑时改用某个服务商（app、name，不给 name 表示用它自己的登录）；global 把它写进那个 agent 自己的配置（app、name）；restore 恢复那个 agent 的原配置（app）。use、global、restore 需要用户在确认卡上同意。看不到也不能设置密钥；添加或删除服务商请用户在“外部 agent → 服务商”里操作。',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'balance', 'speedtest', 'use', 'global', 'restore'] }, app: { type: 'string', enum: ['claude', 'codex', 'gemini'] }, name: { type: 'string' } }, required: ['action'] },
      execute: async (args) => {
        const action = String(args.action)
        const app = args.app === 'claude' || args.app === 'codex' || args.app === 'gemini' ? args.app : undefined
        const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : undefined
        await this.refreshAgents(false)
        const agents = this.agentsCache
        if (action === 'list') {
          return (['claude', 'codex', 'gemini'] as const).map((id) => {
            const inUse = agents.providers[id]?.provider
            const global = agents.global[id]
            const mine = agents.mine[id] ?? []
            const rows = mine.map(item => `  - ${item.name}${item.name === inUse ? '（正在用）' : ''}：${item.baseUrl ?? '未设地址'}${item.model ? `，模型 ${item.model}` : ''}，${item.hasKey ? '已存密钥' : '没有密钥'}${item.usage ? '，可查余额' : ''}`)
            return [`${labels[id]}：用${inUse ?? '它自己的登录'}；全局配置${global?.switched ? `已切到 ${global.provider}` : '未修改'}`, ...(rows.length ? rows : ['  （没有添加服务商）'])].join('\n')
          }).join('\n')
        }
        if (!app)
          return '参数无效：需要 app（claude、codex 或 gemini）。'
        const mine = agents.mine[app] ?? []
        if (name && !mine.some(item => item.name === name))
          return `${labels[app]} 没有叫 ${name} 的服务商。可用的：${mine.map(item => item.name).join('、') || '（无）'}。`
        if ((action === 'balance' || action === 'speedtest' || action === 'global') && !name)
          return '参数无效：需要 name。'
        if (action === 'balance') {
          await this.hub.checkUsage(app, name!)
          const report = (await this.hub.snapshot()).usage[`${app}:${name}`]!
          if (report.error)
            return `没查到：${report.error}`
          const balances = (report.balances ?? []).map(item => `余额 ${item.remaining.toFixed(2)} ${item.unit}`)
          const windows = (report.windows ?? []).map(item => `${item.window === 'five_hour' ? '5 小时窗口' : '本周'}已用 ${Math.round(item.usedPercent)}%${item.resetsAt ? `，${item.resetsAt} 重置` : ''}`)
          return [...balances, ...windows].join('；') || '服务商没有返回额度信息。'
        }
        if (action === 'speedtest') {
          await this.hub.speedtest(app, name!)
          return (await this.hub.snapshot()).speed[`${app}:${name}`]!.results.map(item => `${item.url}：${item.latency !== undefined ? `${item.latency} ms` : item.error}`).join('\n')
        }
        const question = action === 'use'
          ? { reason: `${this.companionName} 想让 ${labels[app]} 改用${name ?? '它自己的登录'}（派活和当大脑时）`, danger: false }
          : action === 'global'
            ? { reason: `${this.companionName} 想把 ${labels[app]} 自己的配置切到 ${name}（会改写它的配置文件，首次会备份）`, danger: true }
            : action === 'restore'
              ? { reason: `${this.companionName} 想把 ${labels[app]} 的配置恢复成切换前的样子`, danger: false }
              : undefined
        if (!question)
          return `不认识的 action：${action}`
        const outcome = await this.escalate({ toolName: 'anna_providers', details: `${labels[app]}${name ? ` → ${name}` : ''}`, ...question })
        if (outcome !== 'allowed')
          return '用户没有同意。不要换个方式再试，问用户想怎么做。'
        if (action === 'use')
          await this.hub.setProvider(app, name)
        else if (action === 'global')
          await this.hub.applyGlobal(app, name!)
        else await this.hub.restoreGlobal(app)
        await this.refreshAgents(false)
        this.publish()
        return action === 'use' ? `好了：${labels[app]} 之后派活和当大脑时用${name ?? '它自己的登录'}。` : action === 'global' ? `好了：${labels[app]} 自己的配置已切到 ${name}。` : `好了：${labels[app]} 的配置已恢复。`
      },
    }
  }

  private statusTool(): AnnaTool {
    return {
      name: 'anna_status',
      label: 'Anna 状态',
      description: '查询 Anna 的版本、内核、模型、权限模式、沙箱、当前角色、已加载插件和实际注册的工具清单。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        let version = 'unknown'
        try { version = (JSON.parse(await readFile(join(this.root, 'package.json'), 'utf8')) as { version: string }).version }
        catch { /* packaged layouts may omit package.json metadata */ }
        return JSON.stringify({ app: 'Anna', version, kernel: this.store.value.kernel, model: this.kernel?.modelInfo, mode: this.effectiveMode(), sandbox: this.sandboxStatus, characterId: this.store.value.characterId, workspace: this.workspacePath, plugins: this.kernel?.plugins, tools: this.kernel?.tools }, null, 2)
      },
    }
  }

  /** The companion on stage: "Anna" names the app, the active companion names whoever is talking. */
  private get companionName() { return companion(this.store.value.characterId).name }

  private async instructions() {
    const persona = await readFile(join(this.root, 'plugins/anna-persona/persona.md'), 'utf8')
    const character = companion(this.store.value.characterId)
    const card = `## 角色卡：${character.name}\n${character.persona}\n（形象来自 Live2D 样例模型「${character.model}」。）`
    const ws = this.workspaceSettings()
    const workspace = `## 当前工作区\n工作文件夹：${this.workspacePath}${ws.trusted ? '' : '\n这个文件夹尚未被用户信任：项目里的 AGENTS.md 等说明没有加载，修改和命令都需要确认。'}`
    const permissions = `## 权限\n工具调用由 Anna 的权限系统把关，模式由用户在界面上切换：规划（只读）、谨慎（每步都问）、协作（工作区内修改与测试直接进行）、放手（沙箱内自主完成）。${this.sandboxStatus.available ? '终端命令运行在沙箱里：只能写工作区、临时目录和包管理缓存，联网会经过确认。' : '这台电脑上没有命令沙箱，命令需要更多确认。'}读取工作文件夹之外的内容（包括 ~/.ssh 这类凭据目录）和可能含密钥的文件，会按模式请用户确认；Anna 自己的数据目录任何情况下都不可访问。被拒绝时你会收到原因，按原因调整做法，不要换个写法绕过。等待确认时不要重复请求。`
    return [persona, card, workspace, permissions, ...(this.store.value.memoryEnabled ? [this.memory.instructions()] : [])]
  }

  /** pi needs a model key; an external brain (Claude Code, Codex) uses its own login. */
  private canConnect(key: string) { return Boolean(key) || this.store.value.kernel !== 'pi' }

  private async connect(key: string) {
    if (!this.canConnect(key))
      throw new Error('请先在模型设置中填写 API Key')
    this.state = 'starting'
    this.error = undefined
    this.publish()
    await mkdir(this.workspacePath, { recursive: true })
    const ws = this.workspaceSettings()
    if (this.sandboxStatus.available) {
      await this.sandbox.start(canonical(this.workspacePath), this.protectedPaths(), (host, port) => this.askNetwork(host, port)).catch((error: Error) => {
        this.sandboxStatus = { available: false, reason: `沙箱启动失败：${error.message}` }
      })
    }
    const factory = this.options.kernel ?? kernels[this.store.value.kernel].create
    const kernel = factory({
      root: this.root,
      data: this.data,
      workspace: this.workspacePath,
      trusted: ws.trusted,
      model: this.store.value.model,
      key,
      instructions: await this.instructions(),
      sessionFile: this.store.value.sessionFile,
      gate: (tool, input) => this.gate(tool, input),
      sandbox: this.sandboxStatus.available ? { wrap: (command, id) => this.sandbox.wrap(command, id) } : undefined,
      tools: this.tools(),
      emit: event => this.presence.handle(event),
      mode: () => this.effectiveMode(),
      locate: agent => this.hub.locate(agent),
      provider: agent => this.hub.choice(agent),
      denyPaths: this.protectedPaths(),
    })
    try {
      await kernel.start()
      this.kernel = kernel
      this.notedMode = undefined
      const brief = kernel.restored ? '' : this.journal.brief(this.workspacePath)
      if (brief)
        kernel.note(brief)
      this.store.value.sessionFile = kernel.sessionFile
      await this.store.save()
      this.refreshHistory()
      this.state = 'ready'
      this.presence.set('idle')
      this.publish()
    }
    catch (error) {
      await kernel.close().catch(() => {})
      this.approvals.cancel()
      this.state = 'error'
      throw error
    }
  }

  async close() {
    this.approvals.cancel()
    if (this.kernel)
      await this.kernel.close()
    this.kernel = undefined
    await this.sandbox.stop()
    this.presence.set('offline')
  }

  // ── Tasks ───────────────────────────────────────────────────────────────────

  /** Queue a task and resolve with Anna's reply. Remote channels wait their turn; the desktop steers a running task instead. */
  submit(text: string, origin: Origin): Promise<string> {
    const body = text.trim()
    if (!body || body.length > 30000)
      return Promise.reject(new Error('消息长度必须为 1–30000 个字符'))
    if (this.mutating)
      return Promise.reject(new Error('Anna 正在切换配置，请稍后再发'))
    const mention = parseMention(body)
    return new Promise<string>((resolve, reject) => {
      this.tasks.push({ id: `${Date.now()}-${randomUUID().slice(0, 8)}`, text: body, origin, resolve, reject, delegate: mention && { agent: mention.agent, provider: mention.provider, task: mention.task } })
      this.publish()
      void this.drain()
    })
  }

  private async drain() {
    if (this.current)
      return
    for (let task = this.tasks.shift(); task; task = this.tasks.shift()) {
      this.current = task
      try { await this.runTask(task) }
      finally { this.current = undefined }
    }
    this.publish()
  }

  private async runTask(task: Task) {
    let key = ''
    try {
      key = await this.vault.read()
      if (!this.kernel)
        await this.connect(key)
      const kernel = this.kernel!
      const mode = this.effectiveMode(task.origin)
      if (mode !== this.notedMode) {
        kernel.note(`[Anna 系统提示] 当前权限模式：${modes[mode].label}（${modes[mode].description}）`)
        this.notedMode = mode
      }
      this.state = 'running'
      this.error = undefined
      this.result = undefined
      this.presence.beginTurn()
      this.refreshHistory()
      this.publish()
      let outcome: { status: 'completed' | 'failed' | 'aborted', text: string, error?: string }
      let reviewed = false
      if (task.delegate) {
        ;(task.collaborators ??= new Set()).add(labelOf(task.delegate.agent))
        const delegated = await this.delegator.run(task.delegate.agent, task.delegate.task, { taskId: task.id, origin: task.origin, providerName: task.delegate.provider })
        kernel.remember('delegation', { task: task.text, text: delegated.text, origin: task.origin, delegation: delegated.delegation })
        outcome = { status: delegated.status, text: delegated.text, error: delegated.status === 'failed' ? delegated.error ?? delegated.text : undefined }
        if (delegated.status === 'completed' && !task.stopped && this.store.value.reviewDelegations && kernel.capabilities.id === 'pi') {
          const review = await this.review(kernel, task, delegated, key)
          reviewed = review.status === 'completed'
          outcome = review
        }
        else {
          kernel.note(`[Anna 系统提示] 用户把任务交给了 ${delegated.delegation.label}：「${task.delegate.task}」。结果（${delegated.status}）：${delegated.text.slice(0, 2000)}`)
        }
      }
      else {
        outcome = await kernel.prompt(task.text, { origin: task.origin })
      }
      const changes = await this.checkpoints.seal(task.id)
      const stats = this.presence.stats
      if (outcome.status === 'aborted')
        kernel.note(`[Anna 系统提示] 用户中断了任务「${task.text.slice(0, 200)}」。这是用户的决定：之后不要主动接着做，也不要“顺带”把它做完。只有用户明确说继续时才继续；下一条消息按它本身来回应。`)
      if (changes.length || outcome.status !== 'completed')
        await this.journal.record({ taskId: task.id, at: new Date().toISOString(), workspace: this.workspacePath, status: outcome.status, origin: task.origin, request: task.text.slice(0, 80), changes: changes.map(change => ({ path: change.path, status: change.status })), by: task.collaborators && [...task.collaborators] }).catch(() => {})
      if (outcome.status === 'completed' && (!task.delegate || reviewed))
        await this.markVerified()
      if (outcome.text)
        this.presence.flushStream(outcome.text)
      const ok = outcome.status === 'completed' && stats.tests !== 'failed'
      const line = outcome.status === 'aborted' ? '好，停下了。' : outcome.status === 'failed' ? '出了点问题。' : ok ? (changes.length ? `改好了 ${changes.length} 个文件。` : '好了。') : '测试还没通过。'
      this.presence.set(outcome.status === 'aborted' ? 'idle' : ok ? 'done' : 'failed', line)
      this.result = {
        taskId: task.id,
        status: outcome.status,
        ok,
        files: [...stats.files],
        changes: changes.map(({ patch: _patch, ...change }) => change),
        commands: stats.commands,
        failedTools: stats.failedTools,
        tests: stats.tests,
        summary: outcome.text.split('\n').find(item => item.trim())?.slice(0, 160) ?? '',
        origin: task.origin,
      }
      this.store.value.sessionFile = kernel.sessionFile
      await this.store.save()
      this.state = 'ready'
      this.error = outcome.status === 'failed' ? this.recordFailure(this.safeError(outcome.error, key)) : undefined
      this.refreshHistory()
      this.emit({ type: 'result', result: this.result })
      if (outcome.status !== 'aborted')
        this.emit({ type: 'notify', title: `${this.companionName}${outcome.status === 'failed' ? ' 遇到问题' : ' 完成了'}`, body: this.result.summary || line })
      this.publish()
      if (outcome.status === 'failed')
        task.reject(new Error(this.error))
      else
        task.resolve(outcome.status === 'aborted' ? '这次任务被停下了。' : outcome.text || line)
    }
    catch (error) {
      const diagnostic = this.safeError(error, key)
      await writeFile(join(this.data, 'last-error.log'), diagnostic, { mode: 0o600 }).catch(() => {})
      this.error = this.recordFailure(diagnostic)
      this.state = this.kernel ? 'ready' : 'error'
      this.presence.set('failed', '出了点问题。')
      this.refreshHistory()
      this.publish()
      task.reject(new Error(this.error))
    }
  }

  /**
   * After an @mention delegation, the companion checks the result with her own tools before the user relies on it.
   * The prompt is hidden from the transcript; her verdict follows the collaborator's report. Files stay untouched.
   */
  private async review(kernel: AgentKernel, task: Task, delegated: DelegationOutcome, key: string): Promise<{ status: 'completed' | 'aborted', text: string }> {
    const label = delegated.delegation.label
    const changes = await this.checkpoints.changes(task.id)
    let budget = 12000
    const diffs = changes.map((change) => {
      const patch = change.patch.slice(0, Math.max(0, budget))
      budget -= patch.length
      return patch.length < change.patch.length ? `${patch}\n…（已截断，请自己读文件）` : patch
    }).filter(Boolean)
    const prompt = [
      `[Anna 系统提示] 用户用 @ 把任务直接交给了 ${label}，它说已经完成。用户看不到这条提示。在用户依赖这个结果之前，请你亲自审阅它，再告诉用户能不能放心用。`,
      `用户的要求：「${delegated.delegation.task}」`,
      `${label} 的汇报：\n${delegated.text.slice(0, 6000)}`,
      changes.length ? `Anna 记录到的文件改动：${changes.map(change => `${change.path}（${change.status}）`).join('、')}\n${diffs.join('\n')}` : 'Anna 没有记录到任何文件改动。',
      '用你自己的工具核实：读改动后的文件，工作区是 git 仓库时可以看 git status / git diff；有现成又很快的测试、类型检查就跑一下，耗时长的不要跑。审阅只检查，不修改任何文件。',
      ...(task.origin === 'desktop' ? [] : ['这个任务来自微信，审阅时不能请用户确认：需要确认的步骤会被拒绝，只做不需要确认的检查。']),
      `最后用几句话告诉用户：${label} 有没有做到用户要的、你核实了什么、发现的问题和没能核实的部分，以及结论（可以放心用 / 需要注意什么 / 不建议直接用）。不要复述它的整段汇报。`,
    ].join('\n\n')
    task.reviewing = true
    this.presence.set('reviewing', `看看 ${label} 交回来的结果…`)
    try {
      const outcome = await kernel.prompt(prompt, { origin: task.origin, hidden: true })
      if (outcome.status === 'aborted')
        return { status: 'aborted', text: delegated.text }
      if (outcome.status === 'completed' && outcome.text)
        return { status: 'completed', text: outcome.text }
      const reason = outcome.status === 'failed' ? this.recordFailure(this.safeError(outcome.error, key)) : '没有给出结论'
      const notice = `没能审阅 ${label} 的结果（${reason}）。上面是它自己的汇报，还没有经过检查。`
      kernel.remember('notice', { text: notice, origin: task.origin })
      return { status: 'completed', text: `${delegated.text}\n\n${notice}` }
    }
    finally { task.reviewing = false }
  }

  /** Record a failure: returns it in plain words, and remembers when the provider refused the key itself. */
  private recordFailure(diagnostic: string) {
    const where = this.store.value.kernel === 'pi' ? '“模型与设置”' : '“外观与能力 → 外部 agent”的服务商设置（没选服务商时是它自己的登录）'
    const { message, keyRejected } = describeModelError(diagnostic.split('\n')[0]!, where)
    if (keyRejected && this.store.value.kernel === 'pi') {
      this.keyRejected = true
      if (this.store.value.modelVerified) {
        this.store.value.modelVerified = false
        void this.store.save()
      }
    }
    return message.slice(0, 350)
  }

  private async markVerified() {
    this.keyRejected = false
    if (this.store.value.kernel !== 'pi' || this.store.value.modelVerified)
      return
    this.store.value.modelVerified = true
    await this.store.save()
  }

  /** Abort the running task, cancel its approvals, and drop queued tasks. Not an error. */
  async stopWork() {
    for (const task of this.tasks.splice(0)) task.reject(new Error('任务已取消'))
    if (this.current)
      this.current.stopped = true
    this.approvals.cancel()
    this.delegator.stop()
    if (this.kernel && this.current)
      await this.kernel.abort()
    this.publish()
  }

  // ── Commands ────────────────────────────────────────────────────────────────

  async execute(command: Command): Promise<RuntimeSnapshot> {
    switch (command.type) {
      case 'snapshot':
        return this.snapshot()
      case 'approval':
        this.approvals.decide(command.id, command.allow, command.scope)
        return this.snapshot()
      case 'character':
        if (!characters.some(character => character.id === command.id))
          throw new Error('未知角色')
        if (command.id === this.store.value.characterId)
          return this.snapshot()
        return this.reconfigure(command)
      case 'stop':
        await this.stopWork()
        return this.snapshot()
      case 'send':
        if (this.current && this.current.origin === 'desktop' && this.kernel?.capabilities.steering) {
          await this.kernel.steer(command.text.trim())
          this.refreshHistory()
          this.publish()
        }
        else {
          await this.submit(command.text, 'desktop').catch((error: Error) => {
            if (error.message !== '任务已取消')
              throw error
          })
        }
        return this.snapshot()
      case 'mode':
        return this.setMode(command.mode)
      case 'rule-remove': {
        this.sessionRules = this.sessionRules.filter(rule => rule !== command.rule)
        const ws = this.workspaceSettings()
        for (const kind of ['allow', 'ask', 'deny'] as const) ws.rules[kind] = ws.rules[kind].filter(rule => rule !== command.rule)
        if (ws.known)
          this.store.value.workspaces[this.workspacePath] = { trusted: ws.trusted, mode: ws.mode, rules: ws.rules }
        await this.store.save()
        this.publish()
        return this.snapshot()
      }
      case 'changes':
        this.emit({ type: 'changes', taskId: command.taskId, changes: await this.checkpoints.changes(command.taskId) })
        return this.snapshot()
      case 'undo': {
        if (this.current)
          throw new Error(`${this.companionName} 正在工作，请先等任务完成或中断`)
        const { restored, conflicts } = await this.checkpoints.undo(command.taskId, command.force)
        if (conflicts.length && !command.force)
          throw new Error(`这些文件在任务之后又被改过：${conflicts.join('、')}。确认要覆盖时再点一次“仍然撤销”。`)
        if (this.result?.taskId === command.taskId)
          this.result = { ...this.result, undone: true }
        await this.journal.markUndone(command.taskId).catch(() => {})
        this.kernel?.note(`[Anna 系统提示] 用户撤销了上一次任务对这些文件的修改：${restored.join('、')}。它们已恢复到任务前的内容。`)
        this.presence.set('idle', `已撤销 ${restored.length} 个文件的改动。`)
        this.publish()
        return this.snapshot()
      }
      case 'agents-refresh':
        await this.refreshAgents(true)
        return this.snapshot()
      case 'agent-provider':
        await this.hub.setProvider(command.agent, command.provider, command.key)
        await this.refreshAgents(false)
        return this.snapshot()
      case 'provider-global':
        await this.hub.applyGlobal(command.app, command.provider)
        await this.refreshAgents(false)
        return this.snapshot()
      case 'provider-save':
        await this.hub.saveProvider(command)
        await this.refreshAgents(false)
        return this.snapshot()
      case 'provider-delete':
        await this.hub.deleteProvider(command.app, command.name)
        await this.refreshAgents(false)
        return this.snapshot()
      case 'provider-speedtest':
        await this.hub.speedtest(command.app, command.name)
        await this.refreshAgents(false)
        return this.snapshot()
      case 'provider-usage':
        await this.hub.checkUsage(command.app, command.name)
        await this.refreshAgents(false)
        return this.snapshot()
      case 'provider-link':
        this.hub.previewLink(command.link)
        await this.refreshAgents(false)
        return this.snapshot()
      case 'provider-link-confirm':
        await this.hub.confirmLink(command.use)
        await this.refreshAgents(false)
        return this.snapshot()
      case 'provider-link-cancel':
        this.hub.cancelLink()
        await this.refreshAgents(false)
        return this.snapshot()
      case 'providers-export':
        if (!command.path)
          throw new Error('没有选择保存位置')
        await this.hub.exportTo(command.path, command.includeKeys)
        return this.snapshot()
      case 'providers-import':
        if (!command.path)
          throw new Error('没有选择文件')
        await this.hub.importFrom(command.path)
        await this.refreshAgents(false)
        return this.snapshot()
      case 'universal-save':
        await this.hub.saveUniversal(command)
        await this.refreshAgents(false)
        return this.snapshot()
      case 'universal-delete':
        await this.hub.deleteUniversal(command.name)
        await this.refreshAgents(false)
        return this.snapshot()
      case 'provider-restore':
        await this.hub.restoreGlobal(command.app)
        await this.refreshAgents(false)
        return this.snapshot()
      case 'ccswitch-import':
        await this.hub.importCcSwitch()
        await this.refreshAgents(false)
        return this.snapshot()
      case 'agent-install':
        this.presence.set('running', `正在安装 ${labelOf(command.agent)}…`)
        await this.hub.install(command.agent)
        await this.refreshAgents(true)
        this.presence.set('done', `${labelOf(command.agent)} 装好了。`)
        return this.snapshot()
      case 'review':
        this.store.value.reviewDelegations = command.enabled
        await this.store.save()
        this.publish()
        return this.snapshot()
      case 'memory-forget':
        await this.memory.forget(command.id)
        this.publish()
        return this.snapshot()
      default:
        return this.reconfigure(command)
    }
  }

  private async setMode(mode: PermissionMode) {
    const ws = this.workspaceSettings()
    if (modes[mode].needsTrust && !ws.trusted)
      throw new Error(`${modes[mode].label}模式只能在你信任的工作文件夹里使用。`)
    const previous = this.effectiveMode('desktop')
    this.store.value.workspaces[this.workspacePath] = { trusted: ws.trusted, mode, rules: ws.rules }
    await this.store.save()
    this.emit({ type: 'mode', mode, previous, line: modes[mode].greeting })
    this.publish()
    return this.snapshot()
  }

  /** Commands that rebuild the kernel: serialized with each other, rejected while a task runs. */
  private reconfigure(command: Command): Promise<RuntimeSnapshot> {
    const run = this.mutations.then(() => this.reconfigureNow(command), () => this.reconfigureNow(command))
    this.mutations = run.catch(() => {})
    return run
  }

  private async reconfigureNow(command: Command): Promise<RuntimeSnapshot> {
    if (this.current)
      throw new Error('请等待当前任务完成，或先中断它')
    this.mutating = true
    let key = ''
    try {
      key = await this.vault.read()
      if (command.type === 'configure') {
        const model = validateModel(command.model)
        if (command.key && (command.key.length > 8192 || /[\r\n\0]/.test(command.key)))
          throw new Error('API Key 格式无效')
        key = command.key.trim() || key
        if (!key)
          throw new Error('请填写 API Key')
        await this.close()
        await this.vault.write(key)
        this.hasKey = true
        if (command.key.trim() || JSON.stringify(model) !== JSON.stringify(this.store.value.model))
          this.store.value.modelVerified = false
        this.keyRejected = false
        this.store.value.model = model
        await this.store.save()
        await this.connect(key)
      }
      else if (command.type === 'workspace') {
        const path = await realpath(command.path)
        if (!(await stat(path)).isDirectory())
          throw new Error('请选择一个工作文件夹')
        await this.close()
        if (this.workspacePath !== path) {
          delete this.store.value.sessionFile
          this.sessionRules = []
          this.result = undefined
        }
        this.store.value.workspace = path
        await this.store.save()
        // Unknown folders wait for the trust decision before the kernel loads anything from them.
        if (this.canConnect(key) && this.workspaceSettings().known)
          await this.connect(key)
        else
          this.state = this.canConnect(key) ? 'stopped' : 'unconfigured'
      }
      else if (command.type === 'trust') {
        const ws = this.workspaceSettings()
        // "Just look first" on a new folder means read-only: Plan, until the user switches.
        const mode = command.trusted ? (ws.known ? ws.mode : 'edit') : ws.known ? stricter(ws.mode, 'ask') : 'plan'
        this.store.value.workspaces[this.workspacePath] = { trusted: command.trusted, mode, rules: ws.rules }
        await this.store.save()
        await this.close()
        if (this.canConnect(key))
          await this.connect(key)
      }
      else if (command.type === 'plugin' || command.type === 'memory') {
        await this.close()
        if (command.type === 'plugin')
          this.store.value.statusEnabled = command.enabled
        else
          this.store.value.memoryEnabled = command.enabled
        await this.store.save()
        await this.connect(key)
      }
      else if (command.type === 'connect' || command.type === 'restart') {
        if (command.type === 'restart')
          await this.close()
        if (!this.kernel && this.workspaceSettings().known)
          await this.connect(key)
      }
      else if (command.type === 'kernel') {
        if (!kernels[command.id]?.available)
          throw new Error('这个内核暂不可用')
        await this.close()
        this.store.value.kernel = command.id
        delete this.store.value.sessionFile
        await this.store.save()
        if (this.canConnect(key))
          await this.connect(key)
      }
      else if (command.type === 'character') {
        const previous = companion(this.store.value.characterId)
        const next = companion(command.id)
        const running = Boolean(this.kernel)
        await this.close()
        this.store.value.characterId = command.id
        await this.store.save()
        if (running) {
          await this.connect(key)
          this.kernel?.note(`[Anna 系统提示] 用户把伙伴从 ${previous.name} 换成了 ${next.name}。从现在起由你（${next.name}）接着陪用户，按你的角色卡说话；之前的回复出自 ${previous.name}。`)
          this.presence.set('idle', next.greeting)
        }
      }
      else if (command.type === 'new-session') {
        await this.close()
        delete this.store.value.sessionFile
        this.sessionRules = []
        this.result = undefined
        await this.store.save()
        if (this.canConnect(key))
          await this.connect(key)
      }
      this.refreshHistory()
      this.publish()
      return this.snapshot()
    }
    catch (error) {
      const diagnostic = this.safeError(error, key)
      await writeFile(join(this.data, 'last-error.log'), diagnostic, { mode: 0o600 }).catch(() => {})
      this.error = this.recordFailure(diagnostic)
      this.state = this.kernel ? 'ready' : 'error'
      this.publish()
      throw new Error(this.error)
    }
    finally { this.mutating = false }
  }

  /** Current rules for display. */
  rules(): RuleSet { return this.workspaceSettings().rules }
}
