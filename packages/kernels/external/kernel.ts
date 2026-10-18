import type { Message, Origin } from '../../shared/contracts'
import type { AgentKernel, KernelCapabilities, KernelContext, TurnOutcome } from '../types'
import type { ToolServer } from './mcp'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { buildLaunch } from '../../agents/launch'
import { runAgent } from '../../agents/runner'
import { mcpServerName, serveTools } from './mcp'

type Entry = { kind: 'user', text: string, origin: Origin } | { kind: 'assistant', text: string, origin: Origin, aborted?: boolean } | { kind: string, data: unknown }
interface Transcript { agentSessionId?: string, entries: Entry[] }

/**
 * An installed agent CLI (Claude Code or Codex) as Anna's brain. Each user message is one headless turn that resumes
 * the agent's own session; Anna's persona, mode and memory go into its system prompt; Anna's own tools (memory,
 * status, delegation) are served to it over a local MCP server; every tool call still passes Anna's gate. Anna keeps
 * her own transcript (the agent's session files are not hers to read).
 */
export class ExternalKernel implements AgentKernel {
  readonly capabilities: KernelCapabilities
  private transcript: Transcript = { entries: [] }
  private file: string
  private notes: string[] = []
  private abortController?: AbortController
  private toolServer?: ToolServer
  restored = false
  plugins: string[]
  tools: string[] = []
  modelInfo = undefined
  constructor(private context: KernelContext, private agent: 'claude' | 'codex') {
    this.capabilities = { id: agent === 'claude' ? 'claude-code' : 'codex', label: agent === 'claude' ? 'Claude Code' : 'Codex', steering: false, sessions: true, shell: process.platform === 'win32' ? 'powershell' : 'bash' }
    this.file = context.sessionFile && existsSync(context.sessionFile) ? context.sessionFile : join(context.data, 'external-sessions', `${this.capabilities.id}-${Date.now()}.json`)
    this.plugins = [this.capabilities.id, 'anna-persona', 'anna-permissions', ...context.tools.map(tool => tool.name.replace('_', '-'))]
  }

  get sessionId() { return this.transcript.agentSessionId ?? '' }
  get sessionFile() { return this.file }

  async start() {
    if (!this.context.locate || !(await this.context.locate(this.agent)))
      throw new Error(`没有在这台电脑上找到 ${this.capabilities.label}，请先在“外部 agent”里安装并登录。`)
    if (existsSync(this.file)) {
      this.transcript = JSON.parse(await readFile(this.file, 'utf8')) as Transcript
      this.restored = this.transcript.entries.length > 0
    }
    if (this.context.tools.length) {
      this.toolServer = await serveTools(this.context.tools)
      this.tools = this.context.tools.map(tool => tool.name)
    }
  }

  /** Anna's instructions, plus where her own tools live under this agent's naming. */
  private instructions() {
    const names = this.tools.map(name => this.agent === 'claude' ? `mcp__${mcpServerName}__${name}` : name)
    const tools = names.length ? [`## Anna 的自带工具\n${names.join('、')} 由 Anna 通过名为 ${mcpServerName} 的 MCP 服务提供：说明里提到 anna_memory、anna_delegate 等工具时，指的就是它们。`] : []
    return [...this.context.instructions, ...tools].join('\n\n')
  }

  private saving: Promise<void> = Promise.resolve()
  /**
   * Writes queue behind each other: a delegation recorded mid-turn (`remember`) and the end of the turn both save,
   * and two writes sharing one temp file would lose a rename.
   */
  private save() {
    const run = this.saving.then(async () => {
      await mkdir(join(this.context.data, 'external-sessions'), { recursive: true, mode: 0o700 })
      await writeFile(`${this.file}.tmp`, JSON.stringify(this.transcript), { mode: 0o600 })
      await rename(`${this.file}.tmp`, this.file)
    })
    this.saving = run.catch(() => {})
    return run
  }

  async prompt(text: string, meta: { origin: Origin }): Promise<TurnOutcome> {
    const located = await this.context.locate!(this.agent)
    if (!located)
      return { status: 'failed', text: '', error: `找不到 ${this.capabilities.label}` }
    // Notes (mode changes, delegation results, undo) are context for the model, sent ahead of the message.
    const notes = this.notes.splice(0)
    const prompt = notes.length ? `${notes.join('\n')}\n\n${text}` : text
    this.transcript.entries.push({ kind: 'user', text, origin: meta.origin })
    const launch = buildLaunch(this.agent, { cwd: this.context.workspace, prompt, mode: this.context.mode?.() ?? 'ask', sessionId: this.transcript.agentSessionId, denyPaths: this.context.denyPaths ?? [], instructions: this.instructions(), tools: this.toolServer })
    this.abortController = new AbortController()
    this.context.emit({ type: 'thinking' })
    const result = await runAgent({
      agent: this.agent,
      command: located.command,
      prefix: located.prefix,
      launch,
      cwd: this.context.workspace,
      sessionId: this.agent === 'codex' ? this.transcript.agentSessionId : undefined,
      gate: async (tool, input) => {
        const verdict = await this.context.gate(tool, input, '')
        return verdict.allow ? { allow: true } : { allow: false, reason: verdict.reason }
      },
      emit: event => this.context.emit(event),
      signal: this.abortController.signal,
    })
    this.abortController = undefined
    if (result.sessionId)
      this.transcript.agentSessionId = result.sessionId
    this.transcript.entries.push(result.status === 'aborted' ? { kind: 'aborted', data: {} } : { kind: 'assistant', text: result.text, origin: meta.origin })
    await this.save()
    return { status: result.status, text: result.text, error: result.error }
  }

  async steer() { throw new Error(`${this.capabilities.label} 不支持在运行中插话`) }
  note(text: string) { this.notes.push(text) }
  remember(kind: string, data: unknown) {
    this.transcript.entries.push({ kind, data })
    void this.save()
  }

  async abort() { this.abortController?.abort() }
  async close() {
    await this.abort()
    await this.toolServer?.close()
    this.toolServer = undefined
  }

  history(): Message[] {
    const out: Message[] = []
    for (const entry of this.transcript.entries) {
      if (entry.kind === 'user' || entry.kind === 'assistant') {
        const message = entry as { kind: 'user' | 'assistant', text: string, origin: Origin }
        if (message.text)
          out.push({ role: message.kind, text: message.text, origin: message.origin })
      }
      else if (entry.kind === 'aborted') {
        out.push({ role: 'assistant', text: '这一轮被中断了。随时可以继续。', note: true })
      }
      else if (entry.kind === 'delegation') {
        const record = (entry as { data: { task: string, text: string, origin?: Origin, delegation: Message['delegation'], nested?: boolean } }).data
        if (!record.nested)
          out.push({ role: 'user', text: record.task, origin: record.origin ?? 'desktop' })
        out.push({ role: 'assistant', text: record.text, origin: record.origin ?? 'desktop', delegation: record.delegation })
      }
    }
    return out
  }
}
