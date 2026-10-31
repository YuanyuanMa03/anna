import type { ChildProcess } from 'node:child_process'
import type { AgentId } from '../../agents/catalog'
import type { Message, Origin } from '../../shared/contracts'
import type { ToolServer } from '../external/mcp'
import type { TranscriptEntry } from '../external/transcript'
import type { AgentKernel, KernelCapabilities, KernelContext, TurnOutcome } from '../types'
import type { AcpToolCall, PermissionOption } from './protocol'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { catalog } from '../../agents/catalog'
import { mcpServerName, serveTools } from '../external/mcp'
import { historyOf } from '../external/transcript'
import { AcpError, Connection, permissionOutcome, toolInput, toolName, toolOutput } from './protocol'

/**
 * Any local agent that speaks the Agent Client Protocol as Anna's brain. The agent runs as one long-lived process with
 * one ACP session; each user message is a `session/prompt`. Anna's instructions open the first prompt of each session,
 * her own tools (memory, status, delegation) are offered as an HTTP MCP server when the agent takes one, and every
 * `session/request_permission` is answered by her gate. Anna keeps her own transcript, as for the other external brains.
 */
export class AcpKernel implements AgentKernel {
  readonly capabilities: KernelCapabilities
  private entries: TranscriptEntry[] = []
  private file: string
  private notes: string[] = []
  private child?: ChildProcess
  private connection?: Connection
  private session = ''
  private introduced = false
  private toolServer?: ToolServer
  /** The turn in progress: her words so far, each tool call (and whether her gate saw it), and why it must stop. */
  private turn?: { text: string, calls: Map<string, { name: string, kind?: string, input: Record<string, unknown>, gated: boolean }>, checks: Promise<void>[], violation?: string, cancelling?: boolean }
  private args: string[]
  /** The end of what the agent wrote to stderr, shown when it fails to start or dies. */
  private stderr = ''
  restored = false
  plugins: string[]
  tools: string[] = []
  modelInfo = undefined
  constructor(private context: KernelContext, private agent: AgentId) {
    const entry = catalog.find(item => item.id === agent)
    if (!entry?.acp)
      throw new Error(`${entry?.label ?? agent} 不支持 ACP，不能当大脑`)
    this.args = entry.acp
    this.capabilities = { id: `acp:${agent}`, label: entry.label, steering: false, sessions: false, shell: process.platform === 'win32' ? 'powershell' : 'bash' }
    this.file = context.sessionFile && existsSync(context.sessionFile) ? context.sessionFile : join(context.data, 'external-sessions', `acp-${agent}-${Date.now()}.json`)
    this.plugins = [this.capabilities.id, 'anna-persona', 'anna-permissions', ...context.tools.map(tool => tool.name.replace('_', '-'))]
  }

  get sessionId() { return this.session }
  get sessionFile() { return this.file }

  async start() {
    const label = this.capabilities.label
    // The agent acts with its own tools, and not every call is put to Anna's gate first. Running the whole agent in her
    // sandbox keeps her own data unreadable and limits writes to the workspace, temp and caches whatever it does.
    if (!this.context.sandbox)
      throw new Error(`为了保护 Anna 的数据，${label} 只在命令沙箱里当大脑，而这台电脑上没有可用的沙箱。`)
    const located = await this.context.locate?.(this.agent)
    if (!located)
      throw new Error(`没有在这台电脑上找到 ${label}，请先在“外部 agent”里安装。`)
    if (existsSync(this.file)) {
      this.entries = (JSON.parse(await readFile(this.file, 'utf8')) as { entries: TranscriptEntry[] }).entries
      this.restored = this.entries.length > 0
    }
    if (this.context.tools.length) {
      this.toolServer = await serveTools(this.context.tools)
      this.tools = this.context.tools.map(tool => tool.name)
    }
    const quote = (part: string) => `'${part.replace(/'/g, `'\\''`)}'`
    const line = [located.command, ...(located.prefix ?? []), ...this.args].map(quote).join(' ')
    this.child = spawn(await this.context.sandbox.wrap(line, `acp-${this.agent}-${Date.now()}`), { cwd: this.context.workspace, stdio: ['pipe', 'pipe', 'pipe'], shell: true, detached: true })
    this.child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-400) })
    this.connection = new Connection(this.child, { request: (method, params) => this.answer(method, params), notify: (method, params) => this.hear(method, params) })
    try {
      const init = await this.connection.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
      const http = Boolean(init?.agentCapabilities?.mcpCapabilities?.http)
      const mcpServers = this.toolServer && http ? [{ type: 'http', name: mcpServerName, url: this.toolServer.url, headers: [{ name: 'Authorization', value: `Bearer ${this.toolServer.token}` }] }] : []
      this.session = (await this.connection.request('session/new', { cwd: this.context.workspace, mcpServers })).sessionId
    }
    catch (error) {
      await this.close()
      throw new Error(this.explain(error))
    }
  }

  /** An agent error in words the person can act on: most failures at this point are a missing login. */
  private explain(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const login = error instanceof AcpError && error.code === -32000
    const stderr = this.stderr.trim() ? `\n${this.stderr.trim()}` : ''
    return `${this.capabilities.label}：${message}${login ? '（请先在终端里登录它）' : ''}${stderr}`
  }

  /** Requests from the agent: permission questions go to Anna's gate; she offers no file system or terminal of her own. */
  private async answer(method: string, params: { toolCall: AcpToolCall, options: PermissionOption[] }) {
    if (method !== 'session/request_permission')
      throw new Error(`Anna does not provide ${method}`)
    // The permission request may leave out the kind; the tool call announced earlier has it.
    const known = this.turn?.calls.get(params.toolCall.toolCallId)
    const call = { ...params.toolCall, kind: params.toolCall.kind ?? known?.kind }
    if (known)
      known.gated = true
    else this.turn?.calls.set(call.toolCallId, { name: toolName(call.kind), kind: call.kind, input: toolInput(call), gated: true })
    if (this.turn?.cancelling)
      return { outcome: { outcome: 'cancelled' } }
    const verdict = await this.context.gate(toolName(call.kind), toolInput(call), call.toolCallId)
    return { outcome: this.turn?.cancelling ? { outcome: 'cancelled' } : permissionOutcome(verdict, params.options) }
  }

  /**
   * A tool call that started without asking her. A change (edit, shell, anything unknown) never may: the turn stops.
   * A read, search or fetch still goes through her gate, and stops the turn if the gate says no.
   */
  private async unasked(id: string) {
    const call = this.turn?.calls.get(id)
    if (!this.turn || !call || call.gated)
      return
    call.gated = true
    const turn = this.turn
    const label = this.capabilities.label
    if (!['read', 'grep', 'fetch', 'think'].includes(call.name))
      return this.stop(turn, `${label} 没有先征得同意就执行了「${call.name}」，这一轮已停止。请在它自己的设置里把审批改为每次询问。`)
    // Fail closed, and stop this call's own turn even if a later one has begun by the time the gate answers.
    try {
      const verdict = await this.context.gate(call.name, call.input, id)
      if (!verdict.allow)
        this.stop(turn, `${label} 没有先征得同意就执行了「${call.name}」，Anna 不同意（${verdict.reason}），这一轮已停止。`)
    }
    catch (error) {
      this.stop(turn, `Anna 没能核对 ${label} 未经询问的「${call.name}」（${error instanceof Error ? error.message : String(error)}），这一轮已停止。`)
    }
  }

  private stop(turn: NonNullable<AcpKernel['turn']>, violation: string) {
    turn.violation ??= violation
    turn.cancelling = true
    // Only the turn still running is cancelled: an older one has already ended, and the session now belongs to another.
    if (turn === this.turn)
      this.connection?.notify('session/cancel', { sessionId: this.session })
  }

  /** Session updates: her words as they stream, thoughts, and tool calls as they start and finish. */
  private hear(method: string, params: { update?: Record<string, any> }) {
    const update = params?.update
    if (method !== 'session/update' || !update || !this.turn)
      return
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        this.turn.text += update.content?.text ?? ''
        this.context.emit({ type: 'text', text: this.turn.text })
        break
      case 'agent_thought_chunk':
        this.context.emit({ type: 'thinking' })
        break
      case 'tool_call': {
        const name = toolName(update.kind)
        const input = toolInput(update as AcpToolCall)
        this.turn.calls.set(update.toolCallId, { name, kind: update.kind, input, gated: false })
        this.context.emit({ type: 'tool-start', id: update.toolCallId, name, input })
        if (update.status === 'in_progress' || update.status === 'completed')
          this.turn.checks.push(this.unasked(update.toolCallId))
        break
      }
      case 'tool_call_update':
        // An update for a call never announced counts as unannounced and unasked: it is registered first, then checked.
        if (!this.turn.calls.has(update.toolCallId)) {
          const call = { name: toolName(update.kind), kind: update.kind, input: toolInput(update as AcpToolCall), gated: false }
          this.turn.calls.set(update.toolCallId, call)
          this.context.emit({ type: 'tool-start', id: update.toolCallId, name: call.name, input: call.input })
        }
        if (update.status === 'in_progress' || update.status === 'completed')
          this.turn.checks.push(this.unasked(update.toolCallId))
        if (update.status === 'completed' || update.status === 'failed')
          this.context.emit({ type: 'tool-end', id: update.toolCallId, name: this.turn.calls.get(update.toolCallId)?.name ?? toolName(update.kind), output: toolOutput(update.content), isError: update.status === 'failed' })
        break
    }
  }

  /** Anna's instructions, plus where her own tools live, opening the first prompt of each session. */
  private instructions() {
    const tools = this.tools.length ? [`## Anna 的自带工具\n${this.tools.join('、')} 由 Anna 通过名为 ${mcpServerName} 的 MCP 服务提供。`] : []
    return [...this.context.instructions, ...tools].join('\n\n')
  }

  /**
   * A new ACP session starts empty, but the person sees the restored conversation: the last few exchanges open the
   * session so she can carry on from them. Empty for a conversation that starts fresh.
   */
  private recap() {
    const recent = historyOf(this.entries).filter(message => !message.note).slice(-8)
    if (!recent.length)
      return ''
    const lines = recent.map(message => `${message.role === 'user' ? '对方' : '你'}：${message.text.length > 400 ? `${message.text.slice(0, 400)}…` : message.text}`)
    return `## 之前的对话（最近几轮）\n${lines.join('\n')}`
  }

  private saving: Promise<void> = Promise.resolve()
  private save() {
    const run = this.saving.then(async () => {
      await mkdir(join(this.context.data, 'external-sessions'), { recursive: true, mode: 0o700 })
      await writeFile(`${this.file}.tmp`, JSON.stringify({ entries: this.entries }), { mode: 0o600 })
      await rename(`${this.file}.tmp`, this.file)
    })
    this.saving = run.catch(() => {})
    return run
  }

  async prompt(text: string, meta: { origin: Origin }): Promise<TurnOutcome> {
    if (!this.connection)
      return { status: 'failed', text: '', error: `${this.capabilities.label} 还没有启动` }
    const intro = this.introduced ? [] : [this.instructions(), this.recap()]
    this.introduced = true
    const body = [...intro, ...this.notes.splice(0), text].filter(Boolean).join('\n\n')
    this.entries.push({ kind: 'user', text, origin: meta.origin })
    const turn: NonNullable<AcpKernel['turn']> = { text: '', calls: new Map(), checks: [] }
    this.turn = turn
    this.context.emit({ type: 'thinking' })
    let outcome: TurnOutcome
    try {
      const result = await this.connection.request('session/prompt', { sessionId: this.session, prompt: [{ type: 'text', text: body }] })
      // A check of an unasked call may still be waiting on her gate: the turn's outcome waits for every verdict.
      await Promise.all(turn.checks)
      if (turn.violation)
        outcome = { status: 'failed', text: turn.text, error: turn.violation }
      else if (result?.stopReason === 'refusal')
        outcome = { status: 'failed', text: turn.text, error: `${this.capabilities.label} 拒绝了这次请求` }
      else outcome = { status: result?.stopReason === 'cancelled' ? 'aborted' : 'completed', text: turn.text }
    }
    catch (error) {
      await Promise.all(turn.checks)
      outcome = { status: 'failed', text: turn.text, error: turn.violation ?? this.explain(error) }
    }
    this.turn = undefined
    this.entries.push(outcome.status === 'aborted' ? { kind: 'aborted', data: {} } : { kind: 'assistant', text: outcome.text, origin: meta.origin })
    await this.save()
    return outcome
  }

  async steer() { throw new Error(`${this.capabilities.label} 不支持在运行中插话`) }
  note(text: string) { this.notes.push(text) }
  remember(kind: string, data: unknown) {
    this.entries.push({ kind, data })
    void this.save()
  }

  async abort() {
    if (!this.turn)
      return
    // A permission question still open is answered "cancelled" from now on, as the protocol asks.
    this.turn.cancelling = true
    this.connection?.notify('session/cancel', { sessionId: this.session })
  }

  async close() {
    await this.abort()
    // The agent runs under a shell and the sandbox's own helpers: end the whole process group, not just the shell.
    if (this.child?.pid) {
      this.child.stdin?.end()
      try { process.kill(-this.child.pid, 'SIGTERM') }
      catch { this.child.kill() }
    }
    this.child = undefined
    this.connection = undefined
    await this.toolServer?.close()
    this.toolServer = undefined
  }

  history(): Message[] { return historyOf(this.entries) }
}
