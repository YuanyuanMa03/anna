import type { DelegateAgent } from '../agents/adapters'
import type { AgentKernel, AnnaTool, GateVerdict, KernelFactory } from '../kernels/types'
import type { PermissionMode } from '../permissions/modes'
import type { RuleSet } from '../permissions/rules'
import type { SandboxStatus } from '../permissions/sandbox'
import type { AgentsSnapshot, AnnaEvent, ApprovalQuestion, Command, Message, Origin, PlatformInfo, RuntimeSnapshot, TaskResult, WorkspaceSettings } from '../shared/contracts'
import type { AgentsOptions, SecretVault } from './agents-hub'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
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
import { MemoryStore } from './memory'
import { Presence } from './presence'
import { SettingsStore, validateModel } from './settings'

export interface CredentialVault { read: () => Promise<string>, write: (key: string) => Promise<void> }
/** A remote channel (Weixin today) that can push text to its owner outside a reply. */
export interface Channel { notify: (text: string) => Promise<boolean> }
interface Task { id: string, text: string, origin: Origin, resolve: (text: string) => void, reject: (error: Error) => void, delegate?: { agent: DelegateAgent, provider?: string, task: string } }
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
  private agentsCache: AgentsSnapshot = { detected: [], providers: {}, global: {}, presets: {}, ccSwitch: false }
  private secretsMode: 'system' | 'file' = 'system'
  readonly channels = new Map<Origin, Channel>()
  readonly store: SettingsStore
  constructor(readonly root: string, readonly data: string, private vault: CredentialVault, private emit: (event: AnnaEvent) => void, private options: HostOptions = {}) {
    this.store = new SettingsStore(data)
    this.checkpoints = new Checkpoints(join(data, 'checkpoints'))
    this.memory = new MemoryStore(data)
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
    const decision = decide(tool, input, this.policyContext(origin))
    if (decision.kind === 'deny')
      return { allow: false, reason: decision.reason }
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
    this.emit({ type: 'notify', title: 'Anna 需要你确认', body: `${question.reason}：${question.details.slice(0, 120)}` })
    const channel = this.channels.get(question.origin)
    if (channel) {
      const body = question.danger
        ? `Anna 需要你确认一个高风险操作（${question.reason}）：\n${question.details}\n请回到 Anna 桌面端处理。`
        : `Anna 需要你确认（${question.reason}）：\n${question.details}\n回复 1 允许，0 拒绝。`
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
    return tools
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

  private async instructions() {
    const persona = await readFile(join(this.root, 'plugins/anna-persona/persona.md'), 'utf8')
    const ws = this.workspaceSettings()
    const workspace = `## 当前工作区\n工作文件夹：${this.workspacePath}${ws.trusted ? '' : '\n这个文件夹尚未被用户信任：项目里的 AGENTS.md 等说明没有加载，修改和命令都需要确认。'}`
    const permissions = `## 权限\n工具调用由 Anna 的权限系统把关，模式由用户在界面上切换：规划（只读）、谨慎（每步都问）、协作（工作区内修改与测试直接进行）、放手（沙箱内自主完成）。${this.sandboxStatus.available ? '终端命令运行在沙箱里：只能写工作区、临时目录和包管理缓存，联网会经过确认。' : '这台电脑上没有命令沙箱，命令需要更多确认。'}读取工作文件夹之外的内容（包括 ~/.ssh 这类凭据目录）和可能含密钥的文件，会按模式请用户确认；Anna 自己的数据目录任何情况下都不可访问。被拒绝时你会收到原因，按原因调整做法，不要换个写法绕过。等待确认时不要重复请求。`
    return [persona, workspace, permissions, ...(this.store.value.memoryEnabled ? [this.memory.instructions()] : [])]
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
      denyPaths: this.protectedPaths(),
    })
    try {
      await kernel.start()
      this.kernel = kernel
      this.notedMode = undefined
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
      if (task.delegate) {
        const delegated = await this.delegator.run(task.delegate.agent, task.delegate.task, { taskId: task.id, origin: task.origin, providerName: task.delegate.provider })
        kernel.remember('delegation', { task: task.text, text: delegated.text, origin: task.origin, delegation: delegated.delegation })
        kernel.note(`[Anna 系统提示] 用户把任务交给了 ${delegated.delegation.label}：「${task.delegate.task}」。结果（${delegated.status}）：${delegated.text.slice(0, 2000)}`)
        outcome = { status: delegated.status, text: delegated.text, error: delegated.status === 'failed' ? delegated.error ?? delegated.text : undefined }
      }
      else {
        outcome = await kernel.prompt(task.text, { origin: task.origin })
      }
      const changes = await this.checkpoints.seal(task.id)
      const stats = this.presence.stats
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
      this.error = outcome.status === 'failed' ? this.safeError(outcome.error, key).split('\n')[0]!.slice(0, 350) : undefined
      this.refreshHistory()
      this.emit({ type: 'result', result: this.result })
      if (outcome.status !== 'aborted')
        this.emit({ type: 'notify', title: outcome.status === 'failed' ? 'Anna 遇到问题' : 'Anna 完成了', body: this.result.summary || line })
      this.publish()
      if (outcome.status === 'failed')
        task.reject(new Error(this.error))
      else
        task.resolve(outcome.status === 'aborted' ? '这次任务被停下了。' : outcome.text || line)
    }
    catch (error) {
      const diagnostic = this.safeError(error, key)
      await writeFile(join(this.data, 'last-error.log'), diagnostic, { mode: 0o600 }).catch(() => {})
      this.error = diagnostic.split('\n')[0]!.slice(0, 350)
      this.state = this.kernel ? 'ready' : 'error'
      this.presence.set('failed', '出了点问题。')
      this.refreshHistory()
      this.publish()
      task.reject(new Error(this.error))
    }
  }

  /** Abort the running task, cancel its approvals, and drop queued tasks. Not an error. */
  async stopWork() {
    for (const task of this.tasks.splice(0)) task.reject(new Error('任务已取消'))
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
        if (!['hiyori', 'haru', 'mark'].includes(command.id))
          throw new Error('未知角色')
        this.store.value.characterId = command.id
        await this.store.save()
        this.publish()
        return this.snapshot()
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
          throw new Error('Anna 正在工作，请先等她完成或中断')
        const { restored, conflicts } = await this.checkpoints.undo(command.taskId, command.force)
        if (conflicts.length && !command.force)
          throw new Error(`这些文件在任务之后又被改过：${conflicts.join('、')}。确认要覆盖时再点一次“仍然撤销”。`)
        if (this.result?.taskId === command.taskId)
          this.result = { ...this.result, undone: true }
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
        this.store.value.workspaces[this.workspacePath] = { trusted: command.trusted, mode: command.trusted ? (ws.known ? ws.mode : 'edit') : stricter(ws.mode, 'ask'), rules: ws.rules }
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
      this.error = diagnostic.split('\n')[0]!.slice(0, 350)
      this.state = this.kernel ? 'ready' : 'error'
      this.publish()
      throw new Error(this.error)
    }
    finally { this.mutating = false }
  }

  /** Current rules for display. */
  rules(): RuleSet { return this.workspaceSettings().rules }
}
