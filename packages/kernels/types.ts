import type { Message, ModelSettings, Origin } from '../shared/contracts'

/**
 * The seam between Anna and an agent kernel (pi today; Claude Code and Codex later).
 * Kernels run the agent loop and their own tools. Anna owns permissions, presence, checkpoints and channels,
 * so a kernel only has to (1) ask `gate` before every tool call and (2) emit these normalized events.
 * Tool names are normalized to: read, write, edit, bash (any shell), grep, find, ls, and anna_* tools.
 */
export type KernelEvent
  = | { type: 'thinking' }
    | { type: 'text', text: string }
    | { type: 'tool-start', id: string, name: string, input: Record<string, unknown> }
    | { type: 'tool-end', id: string, name: string, output: string, isError: boolean }
    | { type: 'compacting', active: boolean }
    | { type: 'retrying', attempt: number }
    /** Anna's routing moved a request to a backup provider (`line` says which, for the stage). */
    | { type: 'failover', line: string }

export type GateVerdict = { allow: true } | { allow: false, reason: string, stop?: boolean }
export type ToolGate = (tool: string, input: Record<string, unknown>, callId: string) => Promise<GateVerdict>

/** Anna-provided tools, described kernel-agnostically (JSON Schema parameters). */
export interface AnnaTool {
  name: `anna_${string}`
  label: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<string>
}

export interface KernelContext {
  root: string
  data: string
  workspace: string
  /** Load project instructions (AGENTS.md, skills). Only for trusted workspaces. */
  trusted: boolean
  model: ModelSettings
  key: string
  /** Appended to the kernel's own system prompt. */
  instructions: string[]
  sessionFile?: string
  gate: ToolGate
  /** Wrap a shell command in the OS sandbox; absent when no sandbox is available. */
  sandbox?: { wrap: (command: string, id: string) => Promise<string> }
  tools: AnnaTool[]
  /** Optional tool allowlist for a constrained deployment such as the public Studio. */
  allowedTools?: string[]
  emit: (event: KernelEvent) => void
  /** The permission mode in force (external kernels map it onto their own flags). */
  mode?: () => import('../permissions/modes').PermissionMode
  /** The provider chosen for this agent under "external agents", the same one a delegation uses (external kernels). */
  provider?: (agent: 'claude' | 'codex') => Promise<import('../agents/providers').ProviderChoice | undefined>
  /** Its backups, tried in order through Anna's routing when it fails (external kernels). */
  backups?: (agent: 'claude' | 'codex') => Promise<import('../agents/providers').ProviderChoice[]>
  /** Where an installed agent CLI lives (external kernels). */
  locate?: (agent: 'claude' | 'codex') => Promise<{ command: string, prefix?: string[] } | undefined>
  /** Paths the kernel must never read or edit. */
  denyPaths?: string[]
}

export interface KernelCapabilities {
  id: 'pi' | 'claude-code' | 'codex'
  label: string
  /** Messages can be inserted into a running turn. */
  steering: boolean
  /** Sessions persist and resume across restarts. */
  sessions: boolean
  /** Which shell tool the kernel exposes on this platform. */
  shell: 'bash' | 'powershell'
}

export interface TurnOutcome {
  status: 'completed' | 'aborted' | 'failed'
  /** Final assistant text produced in this turn only (never an earlier turn's). */
  text: string
  error?: string
}

export interface AgentKernel {
  readonly capabilities: KernelCapabilities
  readonly sessionId: string
  readonly sessionFile?: string
  readonly restored: boolean
  readonly tools: string[]
  readonly plugins: string[]
  readonly modelInfo?: { id: string, thinking: string, contextWindow: number }
  start: () => Promise<void>
  /** `hidden`: Anna's own prompt (e.g. a review request); the model sees it, the transcript does not. */
  prompt: (text: string, meta: { origin: Origin, hidden?: boolean }) => Promise<TurnOutcome>
  steer: (text: string) => Promise<void>
  /** Add context the model sees but the user's transcript does not show (e.g. a permission-mode change). */
  note: (text: string) => void
  /** Persist an Anna record in the session (not model context), e.g. a delegation shown in the history. */
  remember: (kind: string, data: unknown) => void
  abort: () => Promise<void>
  close: () => Promise<void>
  /** The conversation as the user sees it, derived from the kernel's own session. */
  history: () => Message[]
}

export type KernelFactory = (context: KernelContext) => AgentKernel
