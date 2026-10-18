import type { DelegateAgent } from '../agents/adapters'
import type { ProviderChoice } from '../agents/providers'
import type { GateVerdict, KernelEvent } from '../kernels/types'
import type { PermissionMode } from '../permissions/modes'
import type { AnnaEvent, ApprovalQuestion, Delegation, Origin } from '../shared/contracts'
import type { Checkpoints } from './checkpoints'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { approvalStyle } from '../agents/adapters'
import { catalog } from '../agents/catalog'
import { buildLaunch } from '../agents/launch'
import { openRoute } from '../agents/route'
import { runAgent } from '../agents/runner'
import { workspaceFiles } from '../agents/snapshot'
import { modes } from '../permissions/modes'

export const delegateAgents: DelegateAgent[] = ['claude', 'codex', 'gemini', 'opencode', 'pi']
export const labelOf = (agent: string) => catalog.find(item => item.id === agent)?.label ?? agent

/** `@claude …`, `@codex/OpenRouter …` → the agent, an optional provider name, and the task. */
export function parseMention(text: string): { agent: DelegateAgent, provider?: string, task: string } | undefined {
  const match = /^@(claude|codex|gemini|opencode|pi)(?:\/(\S+))?\s(.*)$/is.exec(text.trim())
  const task = match?.[3]?.trim()
  return match && task ? { agent: match[1]!.toLowerCase() as DelegateAgent, provider: match[2], task } : undefined
}

export interface DelegatorDeps {
  data: string
  workspace: () => string
  mode: (origin: Origin) => PermissionMode
  gate: (tool: string, input: Record<string, unknown>) => Promise<GateVerdict>
  escalate: (question: Omit<ApprovalQuestion, 'id' | 'origin'>) => Promise<'allowed' | 'rejected' | 'cancelled'>
  handle: (event: KernelEvent) => void
  supervise: (supervision?: { label: string, onStep: (line: string, step: number) => void }) => void
  steps: () => number
  checkpoints: Checkpoints
  emit: (event: AnnaEvent) => void
  locate: (agent: DelegateAgent) => Promise<{ command: string, prefix?: string[] } | undefined>
  provider: (agent: DelegateAgent, name?: string) => Promise<ProviderChoice | undefined>
  denyPaths: () => string[]
}

export interface DelegationOutcome { status: Delegation['status'], text: string, delegation: Delegation, error?: string }

/**
 * Runs one turn of an external agent for Anna: snapshot the workspace for undo, ask up front when the agent cannot
 * ask mid-run, route its permission requests through Anna's gate, keep its session for follow-ups.
 */
export class Delegator {
  private abort?: AbortController
  constructor(private deps: DelegatorDeps) {}

  private get sessionsFile() { return join(this.deps.data, 'delegations.json') }
  private async sessions(): Promise<Record<string, Record<string, string>>> {
    try { return JSON.parse(await readFile(this.sessionsFile, 'utf8')) }
    catch { return {} }
  }

  private async rememberSession(agent: string, sessionId: string) {
    const all = await this.sessions()
    all[this.deps.workspace()] = { ...all[this.deps.workspace()], [agent]: sessionId }
    await writeFile(`${this.sessionsFile}.tmp`, JSON.stringify(all), { mode: 0o600 })
    await rename(`${this.sessionsFile}.tmp`, this.sessionsFile)
  }

  stop() { this.abort?.abort() }

  async run(agent: DelegateAgent, task: string, context: { taskId: string, origin: Origin, providerName?: string }): Promise<DelegationOutcome> {
    const label = labelOf(agent)
    const workspace = this.deps.workspace()
    const mode = this.deps.mode(context.origin)
    const startSteps = this.deps.steps()
    const base = { agent, label, task, steps: 0 }
    let providerName: string | undefined
    const finish = (status: Delegation['status'], text: string, error?: string): DelegationOutcome => ({ status, text, error, delegation: { ...base, provider: providerName, status, steps: this.deps.steps() - startSteps } })
    const located = await this.deps.locate(agent)
    if (!located)
      return finish('failed', `没有在这台电脑上找到 ${label}。可以在“外观与能力 → 外部 agent”里安装。`, 'not installed')
    const provider = await this.deps.provider(agent, context.providerName)
    providerName = provider?.preset.name
    // Agents that cannot ask mid-run get one up-front approval (their own approval level follows Anna's mode).
    if (approvalStyle[agent] === 'upfront' && mode !== 'auto') {
      const outcome = await this.deps.escalate({ toolName: 'delegate', reason: `让 ${label} 以「${modes[mode].label}」级别处理这个任务（它无法在中途请求授权）`, details: task.slice(0, 600), danger: false })
      if (outcome !== 'allowed')
        return finish('aborted', `你没有同意把任务交给 ${label}。`)
    }
    // Snapshot every file the agent could touch, so the result card can show diffs and undo.
    const before = await workspaceFiles(workspace)
    for (const path of before) await this.deps.checkpoints.capture(context.taskId, workspace, path).catch(() => {})
    const sessionId = (await this.sessions())[workspace]?.[agent]
    const route = await openRoute(agent, provider)
    const launch = buildLaunch(agent, { cwd: workspace, prompt: task, mode, sessionId, provider, denyPaths: this.deps.denyPaths(), route })
    this.abort = new AbortController()
    const card = (state: 'running' | 'done' | 'failed', line: string, step: number) => this.deps.emit({ type: 'collaborator', agent, label, provider: providerName, state, line, step })
    card('running', '开始工作', 0)
    this.deps.supervise({ label, onStep: (line, step) => card('running', line, step - startSteps) })
    try {
      const result = await runAgent({
        agent,
        command: located.command,
        prefix: located.prefix,
        launch,
        cwd: workspace,
        sessionId: agent === 'codex' ? sessionId : undefined,
        gate: async (tool, input) => {
          const verdict = await this.deps.gate(tool, input)
          return verdict.allow ? { allow: true } : { allow: false, reason: verdict.reason }
        },
        emit: event => this.deps.handle(event),
        signal: this.abort.signal,
      })
      if (result.sessionId)
        await this.rememberSession(agent, result.sessionId)
      for (const path of await workspaceFiles(workspace)) {
        if (!await this.deps.checkpoints.has(context.taskId, path))
          await this.deps.checkpoints.markCreated(context.taskId, workspace, path)
      }
      card(result.status === 'completed' ? 'done' : 'failed', result.status === 'completed' ? '完成' : result.error ?? '没有完成', this.deps.steps() - startSteps)
      const text = result.text || (result.status === 'aborted' ? `${label} 被停下了。` : result.status === 'failed' ? `${label} 没有完成：${result.error ?? '未知原因'}` : `${label} 完成了。`)
      return finish(result.status, text, result.error)
    }
    finally {
      route?.close()
      this.deps.supervise(undefined)
      this.abort = undefined
    }
  }
}
