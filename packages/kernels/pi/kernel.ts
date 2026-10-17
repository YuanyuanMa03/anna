import type { AgentSession, AgentSessionEvent, ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { Message, Origin } from '../../shared/contracts'
import type { AgentKernel, AnnaTool, KernelCapabilities, KernelContext, TurnOutcome } from '../types'
import type { Backend } from './backend'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { Type } from '@earendil-works/pi-ai'
import { createAgentSession, createBashToolDefinition, createLocalBashOperations, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { resolveBackend } from './backend'

interface AssistantLike { role: 'assistant', content: { type: string, text?: string }[], stopReason?: string, errorMessage?: string }
interface UserLike { role: 'user', content: string | { type: string, text?: string }[] }

function textOf(content: string | { type: string, text?: string }[]) {
  return typeof content === 'string' ? content : content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

/** pi coding agent as an Anna kernel: in-process AgentSession with pi's prompt, tools, compaction, retries and JSONL sessions. */
export class PiKernel implements AgentKernel {
  readonly capabilities: KernelCapabilities = { id: 'pi', label: 'pi coding agent', steering: true, sessions: true, shell: process.platform === 'win32' ? 'powershell' : 'bash' }
  private session?: AgentSession
  private aborting = false
  private streamText = ''
  restored = false
  plugins: string[] = []
  constructor(private context: KernelContext, private backend?: Backend) {}

  get sessionId() { return this.session?.sessionId ?? '' }
  get sessionFile() { return this.session?.sessionFile }
  get tools() { return this.session?.getActiveToolNames() ?? [] }
  get modelInfo() {
    const model = this.session?.model
    return model ? { id: model.id, thinking: this.session!.thinkingLevel, contextWindow: model.contextWindow } : undefined
  }

  private annaTool(tool: AnnaTool): ToolDefinition {
    return {
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: Type.Unsafe<Record<string, unknown>>(tool.parameters),
      execute: async (_id: string, params: unknown) => ({ content: [{ type: 'text', text: await tool.execute(params as Record<string, unknown>) }], details: undefined }),
    } as unknown as ToolDefinition
  }

  /** The shell tool, wrapped by the OS sandbox when Anna has one. */
  private shellTool(): ToolDefinition | undefined {
    const sandbox = this.context.sandbox
    if (!sandbox || this.capabilities.shell !== 'bash')
      return undefined
    const local = createLocalBashOperations()
    let counter = 0
    return createBashToolDefinition(this.context.workspace, {
      exposeSessionEnvironment: false,
      operations: { exec: async (command, cwd, options) => local.exec(await sandbox.wrap(command, `anna-${Date.now()}-${counter++}`), cwd, options) },
    }) as unknown as ToolDefinition
  }

  private extension(pi: ExtensionAPI) {
    pi.on('tool_call', async (event) => {
      const verdict = await this.context.gate(event.toolName, (event.input ?? {}) as Record<string, unknown>, event.toolCallId)
      if (!verdict.allow)
        return { block: true, reason: verdict.reason, terminate: verdict.stop }
    })
  }

  async start() {
    const { modelRuntime, model } = this.backend ?? await resolveBackend(this.context.model, this.context.key, this.context.data)
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 3 } })
    const untrusted = !this.context.trusted
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.context.workspace,
      agentDir: join(this.context.data, 'pi-agent'),
      settingsManager,
      noExtensions: true,
      noContextFiles: untrusted,
      noSkills: untrusted,
      noPromptTemplates: untrusted,
      extensionFactories: [pi => this.extension(pi)],
      appendSystemPromptOverride: () => this.context.instructions,
    })
    await resourceLoader.reload()
    const sessionDir = join(this.context.data, 'pi-sessions')
    const resume = this.context.sessionFile && existsSync(this.context.sessionFile)
    const sessionManager = resume ? SessionManager.open(this.context.sessionFile!, sessionDir, this.context.workspace) : SessionManager.create(this.context.workspace, sessionDir)
    const shell = this.shellTool()
    const builtin = ['read', 'edit', 'write', 'grep', 'find', 'ls', ...(shell ? [] : [this.capabilities.shell])]
    const custom = [...(shell ? [shell] : []), ...this.context.tools.map(tool => this.annaTool(tool))]
    const { session } = await createAgentSession({
      cwd: this.context.workspace,
      agentDir: join(this.context.data, 'pi-agent'),
      modelRuntime,
      model,
      thinkingLevel: model.reasoning ? 'medium' : 'off',
      tools: [...builtin, ...custom.map(tool => tool.name)],
      customTools: custom,
      resourceLoader,
      sessionManager,
      settingsManager,
    })
    this.session = session
    this.restored = Boolean(resume && session.messages.length)
    session.subscribe(event => this.forward(event))
    this.plugins = ['pi-coding-agent', 'anna-persona', 'anna-permissions', ...(shell ? ['anna-sandbox'] : []), ...this.context.tools.map(tool => tool.name.replace('_', '-'))]
  }

  private forward(event: AgentSessionEvent) {
    const emit = this.context.emit
    switch (event.type) {
      case 'agent_start':
        emit({ type: 'thinking' })
        break
      case 'message_start':
        if (event.message.role === 'assistant')
          this.streamText = ''
        break
      case 'message_update':
        if (event.assistantMessageEvent.type === 'text_delta') {
          this.streamText += event.assistantMessageEvent.delta
          emit({ type: 'text', text: this.streamText })
        }
        else if (event.assistantMessageEvent.type === 'thinking_delta') {
          emit({ type: 'thinking' })
        }
        break
      case 'tool_execution_start':
        if (!event.parentToolCallId)
          emit({ type: 'tool-start', id: event.toolCallId, name: event.toolName, input: (event.args ?? {}) as Record<string, unknown> })
        break
      case 'tool_execution_end':
        if (!event.parentToolCallId)
          emit({ type: 'tool-end', id: event.toolCallId, name: event.toolName, output: resultText(event.result), isError: event.isError })
        break
      case 'compaction_start':
        emit({ type: 'compacting', active: true })
        break
      case 'compaction_end':
        emit({ type: 'compacting', active: false })
        break
      case 'auto_retry_start':
        emit({ type: 'retrying', attempt: event.attempt })
        break
    }
  }

  async prompt(text: string, meta: { origin: Origin, hidden?: boolean }): Promise<TurnOutcome> {
    const session = this.session
    if (!session)
      throw new Error('内核尚未启动')
    this.aborting = false
    session.sessionManager.appendCustomEntry('anna.origin', { origin: meta.origin })
    if (meta.hidden)
      session.sessionManager.appendCustomEntry('anna.hidden', {})
    const before = session.messages.length
    let error: string | undefined
    try { await session.prompt(text) }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    const turn = session.messages.slice(before).filter(message => message.role === 'assistant') as unknown as AssistantLike[]
    const finalText = [...turn].reverse().map(message => textOf(message.content).trim()).find(Boolean) ?? ''
    const last = turn.at(-1)
    if (this.aborting || last?.stopReason === 'aborted') {
      session.sessionManager.appendCustomEntry('anna.aborted', {})
      return { status: 'aborted', text: finalText }
    }
    if (error || last?.stopReason === 'error')
      return { status: 'failed', text: finalText, error: error ?? last?.errorMessage ?? '模型请求失败' }
    return { status: 'completed', text: finalText }
  }

  async steer(text: string) { await this.session?.steer(text) }

  remember(kind: string, data: unknown) { this.session?.sessionManager.appendCustomEntry(`anna.${kind}`, data) }

  note(text: string) { this.session?.sessionManager.appendCustomMessageEntry('anna.note', text, false) }

  async abort() {
    this.aborting = true
    await this.session?.abort().catch(() => {})
  }

  async close() {
    await this.abort()
    this.session?.dispose()
    this.session = undefined
  }

  /** Visible conversation from the session branch: user messages (not Anna's hidden prompts), each turn's final reply, and notes. */
  history(): Message[] {
    const manager = this.session?.sessionManager
    if (!manager)
      return []
    const out: Message[] = []
    let origin: Origin = 'desktop'
    let reply: Message | undefined
    let hideNext = false
    const flush = () => {
      if (reply?.text)
        out.push(reply); reply = undefined
    }
    for (const entry of manager.getBranch()) {
      if (entry.type === 'custom' && entry.customType === 'anna.origin') {
        origin = ((entry.data as { origin?: Origin })?.origin) ?? 'desktop'
      }
      else if (entry.type === 'custom' && entry.customType === 'anna.delegation') {
        flush()
        const record = entry.data as { task: string, text: string, origin?: Origin, delegation: Message['delegation'], nested?: boolean }
        if (!record.nested)
          out.push({ role: 'user', text: record.task, origin: record.origin ?? 'desktop' })
        out.push({ role: 'assistant', text: record.text, origin: record.origin ?? 'desktop', delegation: record.delegation })
      }
      else if (entry.type === 'custom' && entry.customType === 'anna.aborted') {
        flush()
        out.push({ role: 'assistant', text: '这一轮被中断了。随时可以继续。', origin, note: true })
      }
      else if (entry.type === 'custom' && entry.customType === 'anna.notice') {
        flush()
        const record = entry.data as { text: string, origin?: Origin }
        out.push({ role: 'assistant', text: record.text, origin: record.origin ?? origin, note: true })
      }
      else if (entry.type === 'custom' && entry.customType === 'anna.hidden') {
        hideNext = true
      }
      else if (entry.type === 'message' && entry.message.role === 'user') {
        flush()
        if (hideNext) {
          hideNext = false
          continue
        }
        out.push({ role: 'user', text: textOf((entry.message as unknown as UserLike).content), origin })
      }
      else if (entry.type === 'message' && entry.message.role === 'assistant') {
        const text = textOf((entry.message as unknown as AssistantLike).content).trim()
        if (text)
          reply = { role: 'assistant', text, origin }
      }
    }
    flush()
    return out
  }
}

function resultText(result: unknown) {
  const content = (result as { content?: { type: string, text?: string }[] })?.content
  if (!Array.isArray(content))
    return typeof result === 'string' ? result : JSON.stringify(result)
  return content.map(block => block.type === 'text' ? block.text ?? '' : `[${block.type}]`).join('\n')
}

export function createPiKernel(context: KernelContext, backend?: Backend): AgentKernel { return new PiKernel(context, backend) }
