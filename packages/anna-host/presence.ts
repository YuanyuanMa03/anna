import type { KernelEvent } from '../kernels/types'
import type { AnnaPhase, AnnaState, ToolActivity } from '../shared/contracts'
import { basename } from 'node:path'
import { isVerification } from '../permissions/commands'

/** Reduce one tool call to the phase the stage shows and the subtitle Anna says about it. */
export function describeTool(tool: string, input: Record<string, unknown>): { phase: AnnaPhase, line: string, target?: string } {
  const path = typeof input.path === 'string' ? input.path : undefined
  const name = path ? basename(path) || path : undefined
  if (tool === 'read')
    return { phase: 'inspecting', line: `正在读 ${name ?? '文件'}`, target: path }
  if (tool === 'ls' || tool === 'find')
    return { phase: 'inspecting', line: `正在看 ${name ?? '目录'} 里有什么`, target: path }
  if (tool === 'grep')
    return { phase: 'inspecting', line: `正在搜索「${String(input.pattern ?? '').slice(0, 40)}」`, target: path }
  if (tool === 'edit')
    return { phase: 'editing', line: `正在修改 ${name ?? '文件'}`, target: path }
  if (tool === 'write')
    return { phase: 'editing', line: `正在写 ${name ?? '文件'}`, target: path }
  if (tool === 'bash' || tool === 'powershell') {
    const command = String(input.command ?? '').trim()
    const short = command.split('\n')[0]!.slice(0, 60)
    return isVerification(command) ? { phase: 'testing', line: `正在验证：${short}` } : { phase: 'running', line: `正在运行：${short}` }
  }
  if (tool === 'anna_status')
    return { phase: 'inspecting', line: '正在检查自己的状态' }
  if (tool === 'anna_memory')
    return { phase: 'inspecting', line: '正在翻看记忆' }
  if (tool === 'anna_providers')
    return { phase: 'inspecting', line: '正在看服务商' }
  return { phase: 'running', line: `正在使用 ${tool}` }
}

const agentLabels: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', opencode: 'OpenCode', pi: 'Pi' }

export interface TurnStats { files: Set<string>, commands: number, failedTools: number, tests?: 'passed' | 'failed', step: number }
export type PresenceOutput = { type: 'anna', state: AnnaState } | { type: 'stream', text: string } | { type: 'tool', activity: ToolActivity }

/**
 * Kernel-agnostic presence: turns normalized kernel events into the stage state, the live subtitle, the tool trail,
 * and the per-turn statistics behind the result card. Waiting for approvals stacks, so parallel prompts restore correctly.
 */
export class Presence {
  state: AnnaState = { phase: 'offline', line: '', step: 0 }
  stats: TurnStats = Presence.fresh()
  private calls = new Map<string, { name: string, input: Record<string, unknown> }>()
  private waiting = 0
  private beforeWait?: AnnaState
  private streamAt = 0
  /** While an external agent works, Anna supervises: tool events update the collaborator card, not her pose. */
  supervising?: { label: string, onStep: (line: string, step: number) => void }
  constructor(private emit: (output: PresenceOutput) => void) {}
  private static fresh(): TurnStats { return { files: new Set(), commands: 0, failedTools: 0, step: 0 } }

  set(phase: AnnaPhase, line = '', target?: string) {
    this.state = { phase, line, step: this.stats.step, target }
    if (this.waiting && phase !== 'waiting')
      this.beforeWait = this.state
    else
      this.emit({ type: 'anna', state: this.state })
  }

  beginTurn() {
    this.stats = Presence.fresh()
    this.calls.clear()
    this.set('thinking', '让我想想…')
  }

  wait(reason: string) {
    if (this.waiting++ === 0)
      this.beforeWait = this.state
    this.state = { phase: 'waiting', line: `等你确认：${reason}`, step: this.stats.step }
    this.emit({ type: 'anna', state: this.state })
  }

  resume() {
    if (this.waiting === 0 || --this.waiting > 0)
      return
    const restore = this.beforeWait ?? { phase: 'thinking', line: '', step: this.stats.step }
    this.beforeWait = undefined
    this.state = restore.phase === 'waiting' ? { phase: 'thinking', line: '', step: this.stats.step } : restore
    this.emit({ type: 'anna', state: this.state })
  }

  /** Record a file the turn changed (the host knows paths precisely from the permission gate). */
  changed(path: string) { this.stats.files.add(path) }

  handle(event: KernelEvent) {
    switch (event.type) {
      case 'thinking':
        if (this.supervising)
          break
        // Reading a collaborator's result is thinking too; keep the reviewing pose until she speaks or acts.
        if (this.state.phase !== 'thinking' && this.state.phase !== 'waiting' && this.state.phase !== 'reviewing')
          this.set('thinking', '让我想想…')
        break
      case 'text': {
        if (this.supervising) {
          this.supervising.onStep(event.text.split('\n').find(line => line.trim())?.slice(0, 80) ?? '', this.stats.step)
          break
        }
        if (this.state.phase !== 'responding' && this.state.phase !== 'waiting')
          this.set('responding')
        const now = Date.now()
        if (now - this.streamAt > 70) {
          this.streamAt = now
          this.emit({ type: 'stream', text: event.text })
        }
        break
      }
      case 'tool-start': {
        this.stats.step++
        this.calls.set(event.id, { name: event.name, input: event.input })
        if (event.name === 'bash' || event.name === 'powershell')
          this.stats.commands++
        const described = describeTool(event.name, event.input)
        if (this.supervising)
          this.supervising.onStep(described.line, this.stats.step)
        else
          this.set(described.phase, described.line, described.target)
        this.emit({ type: 'tool', activity: { name: event.name, phase: 'call', callId: event.id, text: clip(JSON.stringify(event.input, null, 2)) } })
        break
      }
      case 'tool-end': {
        const call = this.calls.get(event.id)
        if (event.isError)
          this.stats.failedTools++
        if (call && describeTool(call.name, call.input).phase === 'testing')
          this.stats.tests = event.isError ? 'failed' : 'passed'
        this.emit({ type: 'tool', activity: { name: event.name, phase: 'result', callId: event.id, text: clip(event.output), isError: event.isError } })
        if (this.supervising)
          break
        if (call?.name === 'anna_delegate' && !event.isError)
          this.set('reviewing', `看看 ${agentLabels[String(call.input.agent)] ?? '协作者'} 交回来的结果…`)
        else
          this.set('thinking', event.isError ? '这一步没成功，我看看…' : '想想下一步…')
        break
      }
      case 'compacting':
        this.set(event.active ? 'compacting' : 'thinking', event.active ? '整理一下前面的上下文…' : '整理好了，继续。')
        break
      case 'retrying':
        this.set('retrying', `模型连接不稳，第 ${event.attempt} 次重试…`)
        break
      case 'failover':
        this.set('retrying', event.line)
        break
    }
  }

  flushStream(text: string) { this.emit({ type: 'stream', text }) }
}

function clip(text: string) { return text.length > 4000 ? `${text.slice(0, 4000)}…` : text }
