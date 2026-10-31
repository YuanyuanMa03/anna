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
  private turn?: { text: string, tools: Map<string, string> }
  private args: string[]
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
    // Windows starts npm's .cmd shims through a shell, so every part is quoted (paths under C:\Program Files).
    const windows = process.platform === 'win32'
    const quote = (part: string) => windows && /[\s"]/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part
    this.child = spawn(quote(located.command), [...(located.prefix ?? []), ...this.args].map(quote), { cwd: this.context.workspace, stdio: ['pipe', 'pipe', 'ignore'], shell: windows })
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
    return `${this.capabilities.label}：${message}${login ? '（请先在终端里登录它）' : ''}`
  }

  /** Requests from the agent: permission questions go to Anna's gate; she offers no file system or terminal of her own. */
  private async answer(method: string, params: { toolCall: AcpToolCall, options: PermissionOption[] }) {
    if (method !== 'session/request_permission')
      throw new Error(`Anna does not provide ${method}`)
    const name = toolName(params.toolCall.kind)
    const verdict = await this.context.gate(name, toolInput(params.toolCall), params.toolCall.toolCallId)
    return { outcome: permissionOutcome(verdict, params.options) }
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
        this.turn.tools.set(update.toolCallId, name)
        this.context.emit({ type: 'tool-start', id: update.toolCallId, name, input: toolInput(update as AcpToolCall) })
        break
      }
      case 'tool_call_update':
        if (update.status === 'completed' || update.status === 'failed')
          this.context.emit({ type: 'tool-end', id: update.toolCallId, name: this.turn.tools.get(update.toolCallId) ?? toolName(update.kind), output: toolOutput(update.content), isError: update.status === 'failed' })
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
    this.turn = { text: '', tools: new Map() }
    this.context.emit({ type: 'thinking' })
    let outcome: TurnOutcome
    try {
      const result = await this.connection.request('session/prompt', { sessionId: this.session, prompt: [{ type: 'text', text: body }] })
      outcome = { status: result?.stopReason === 'cancelled' ? 'aborted' : 'completed', text: this.turn.text }
    }
    catch (error) {
      outcome = { status: 'failed', text: this.turn.text, error: this.explain(error) }
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
    if (this.turn)
      this.connection?.notify('session/cancel', { sessionId: this.session })
  }

  async close() {
    await this.abort()
    this.child?.kill()
    this.child = undefined
    this.connection = undefined
    await this.toolServer?.close()
    this.toolServer = undefined
  }

  history(): Message[] { return historyOf(this.entries) }
}
