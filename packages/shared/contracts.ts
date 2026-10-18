import type { CharacterId } from '../character/manifest'
import type { PermissionMode } from '../permissions/modes'
import type { RuleSet } from '../permissions/rules'
import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export type { PermissionMode } from '../permissions/modes'
export type { RuleSet } from '../permissions/rules'

export interface ModelSettings {
  provider: 'deepseek-official' | 'custom'
  model: string
  baseURL: string
  api: 'anthropic-messages' | 'openai-completions' | 'openai-responses'
}
/** Per-workspace permissions, like Claude Code's project settings. */
export interface WorkspaceSettings { trusted: boolean, mode: PermissionMode, rules: RuleSet }
export interface Settings {
  version: 2
  /** Anna's brain: pi (built in) or an installed agent CLI. */
  kernel: 'pi' | 'claude-code' | 'codex'
  characterId: CharacterId
  statusEnabled: boolean
  memoryEnabled: boolean
  /** The companion reviews what an @mentioned agent did before reporting (costs one model turn). */
  reviewDelegations: boolean
  model: ModelSettings
  /** Kernel session file that the next start continues. */
  sessionFile?: string
  /** The saved model key has answered a real request (cleared when the key or model changes). */
  modelVerified?: boolean
  workspace?: string
  workspaces: Record<string, WorkspaceSettings>
  /** Provider chosen for each external agent when Anna delegates to it (keys live in the encrypted store). */
  agents?: Record<string, { provider?: string }>
  /** Providers imported from cc-switch or added by hand (connection fields only, no keys). */
  providers?: CustomProvider[]
  universal?: UniversalProvider[]
}
export interface CustomProvider { app: 'claude' | 'codex' | 'gemini', name: string, source?: 'preset' | 'custom' | 'imported' | 'universal', preset: { name: string, official: boolean, category: string, website?: string, apiKeyUrl?: string, env?: Record<string, string>, keyField?: string, baseUrl?: string, model?: string, wireApi?: string, reasoningEffort?: string, models?: { model: string }[] } }
export interface AgentStatus {
  id: string
  label: string
  tier: 'delegate' | 'switch'
  installed: boolean
  path?: string
  version?: string
  loggedIn?: boolean
  configured: boolean
  configDir: string
  install?: string
  /** How a delegate agent asks for permission. */
  approvals?: 'forwarded' | 'upfront'
  /** Its adapter has been verified against a real recorded session. */
  verified?: boolean
}
/** A provider in the user's own list for one app: added from a preset, written by hand, or imported from cc-switch. */
export interface MyProvider {
  name: string
  source: 'preset' | 'custom' | 'imported' | 'universal'
  category: string
  baseUrl?: string
  model?: string
  website?: string
  apiKeyUrl?: string
  hasKey: boolean
}
export interface PresetSummary { name: string, category: string, official: boolean, apiKeyUrl?: string, website?: string, baseUrl?: string, model?: string }
export interface AgentsSnapshot {
  detected: AgentStatus[]
  providers: Record<string, { provider?: string, hasKey: boolean }>
  global: Record<string, { switched: boolean, provider?: string }>
  presets: Record<string, PresetSummary[]>
  mine: Record<string, MyProvider[]>
  universal: (UniversalProvider & { hasKey: boolean })[]
  /** The last speed test per provider (`app:name`), fastest first; candidates already carry the provider's path. */
  speed: Record<string, { at: string, results: { url: string, latency?: number, status?: number, error?: string }[] }>
  ccSwitch: boolean
}
/**
 * One gateway (NewAPI and the like) for Claude Code, Codex and Gemini CLI at once, as in cc-switch: Anna keeps a
 * linked provider per enabled app, and edits or deletes them together.
 */
export interface UniversalProvider {
  name: string
  baseUrl: string
  apps: { claude: boolean, codex: boolean, gemini: boolean }
  models: { claude?: { model?: string, haiku?: string, sonnet?: string, opus?: string }, codex?: { model?: string, reasoningEffort?: string }, gemini?: { model?: string } }
  website?: string
}
export type UniversalDraft = UniversalProvider & { previous?: string, key?: string }
/** Add or edit one of the user's providers. `from` names the preset it starts from; `previous` the entry being edited. */
export interface ProviderDraft { app: 'claude' | 'codex' | 'gemini', name: string, previous?: string, from?: string, baseUrl?: string, model?: string, key?: string }
export type Origin = 'desktop' | 'weixin'
export interface ApprovalQuestion {
  id: string
  toolName: string
  reason: string
  details: string
  danger: boolean
  origin: Origin
  /** The rule "always allow" would add (absent for dangerous calls, which are one at a time). */
  rule?: string
}
export type ApprovalScope = 'once' | 'session' | 'always'
export type ApprovalOutcome = 'allowed-once' | 'allowed-session' | 'allowed-always' | 'rejected' | 'cancelled'
export interface WeixinState { phase: 'offline' | 'loading' | 'waiting' | 'scanned' | 'need-code' | 'connected' | 'expired' | 'error', message: string, qr?: string }
/** An external agent's turn, shown as a collapsible block in the conversation. */
export interface Delegation { agent: string, label: string, provider?: string, status: 'completed' | 'failed' | 'aborted', steps: number, task: string }
export interface Message { role: 'user' | 'assistant', text: string, origin?: Origin, /** System note such as an interruption. */ note?: boolean, delegation?: Delegation }
export interface MemoryItem { id: string, text: string, createdAt: string }
export interface FileChange { path: string, status: 'added' | 'modified' | 'deleted', added: number, removed: number, patch: string }

/** What the stage performs. Derived from real runtime events only; the model never sets it. */
export type AnnaPhase = 'offline' | 'idle' | 'thinking' | 'responding' | 'inspecting' | 'editing' | 'running' | 'testing' | 'waiting' | 'compacting' | 'retrying' | 'supervising' | 'reviewing' | 'done' | 'failed'
export interface AnnaState { phase: AnnaPhase, line: string, step: number, target?: string }
/** Deliverable summary for one finished task. */
export interface TaskResult {
  taskId: string
  status: 'completed' | 'aborted' | 'failed'
  ok: boolean
  files: string[]
  changes: { path: string, status: FileChange['status'], added: number, removed: number }[]
  commands: number
  failedTools: number
  tests?: 'passed' | 'failed'
  summary: string
  origin: Origin
  undone?: boolean
}
export interface ToolActivity { name: string, phase: 'call' | 'result', callId: string, text: string, isError?: boolean }
export interface PlatformInfo { os: string, shell: 'bash' | 'powershell', sandbox: { available: boolean, reason?: string }, secrets: 'system' | 'file' }

export interface RuntimeSnapshot {
  state: 'unconfigured' | 'stopped' | 'starting' | 'ready' | 'running' | 'error'
  error?: string
  plugins: string[]
  tools: string[]
  sessionId?: string
  restored: boolean
  settings: Settings
  hasKey: boolean
  /** Omitted from pushed snapshots when the conversation did not change. */
  messages?: Message[]
  approvals: ApprovalQuestion[]
  anna: AnnaState
  queue: string[]
  result?: TaskResult
  model?: { id: string, thinking: string, contextWindow: number }
  kernel: { id: string, label: string }
  /** Whether pi's model key is known to work: unverified until a real reply, rejected after an auth error. */
  credential?: 'unverified' | 'verified' | 'rejected'
  /** The mode in force for the current workspace, after trust clamping. */
  mode: PermissionMode
  workspace: { path: string, trusted: boolean, rules: RuleSet, known: boolean }
  /** Session-only rules granted with "本次会话都允许". */
  sessionRules: string[]
  platform: PlatformInfo
  memories: MemoryItem[]
  agents: AgentsSnapshot
}
/** Only these product events cross the preload boundary. Kernel objects stay in the core process. */
export type AnnaEvent = { type: 'navigate', panel: 'settings' | 'sponsor' } | { type: 'snapshot', snapshot: RuntimeSnapshot }
  | { type: 'weixin', state: WeixinState }
  | ({ type: 'tool' } & ToolActivity)
  | { type: 'anna', state: AnnaState }
  | { type: 'stream', text: string }
  | { type: 'result', result: TaskResult }
  | { type: 'mode', mode: PermissionMode, previous: PermissionMode, line: string }
  | { type: 'changes', taskId: string, changes: FileChange[] }
  | { type: 'notify', title: string, body: string }
  | { type: 'core', status: 'restarting' | 'ready', message?: string }
  | { type: 'update', state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'current', version?: string, notes?: string, message?: string }
  | { type: 'collaborator', agent: string, label: string, provider?: string, state: 'running' | 'done' | 'failed', line: string, step: number }
export type Command = { type: 'snapshot' } | { type: 'send', text: string }
  | { type: 'character', id: CharacterId } | { type: 'plugin', enabled: boolean }
  | { type: 'configure', model: ModelSettings, key: string } | { type: 'connect' }
  | { type: 'restart' } | { type: 'stop' } | { type: 'new-session' }
  | { type: 'workspace', path: string }
  | { type: 'choose-workspace' }
  | { type: 'trust', trusted: boolean }
  | { type: 'mode', mode: PermissionMode }
  | { type: 'approval', id: string, allow: boolean, scope?: ApprovalScope }
  | { type: 'rule-remove', rule: string }
  | { type: 'changes', taskId: string }
  | { type: 'undo', taskId: string, force?: boolean }
  | { type: 'memory', enabled: boolean }
  | { type: 'memory-forget', id: string }
  | { type: 'review', enabled: boolean }
  | { type: 'agents-refresh' }
  | { type: 'agent-provider', agent: string, provider?: string, key?: string }
  | { type: 'provider-global', app: 'claude' | 'codex' | 'gemini', provider: string }
  | { type: 'provider-restore', app: 'claude' | 'codex' | 'gemini' }
  | ({ type: 'provider-save' } & ProviderDraft)
  | { type: 'provider-delete', app: 'claude' | 'codex' | 'gemini', name: string }
  | { type: 'provider-speedtest', app: 'claude' | 'codex' | 'gemini', name: string }
  | ({ type: 'universal-save' } & UniversalDraft)
  | { type: 'universal-delete', name: string }
  | { type: 'ccswitch-import' }
  | { type: 'agent-install', agent: string }
  | { type: 'kernel', id: 'pi' | 'claude-code' | 'codex' }
  | { type: 'update-check' }
  | { type: 'update-install' }
  | { type: 'weixin-status' } | { type: 'weixin-login' } | { type: 'weixin-disconnect' }
  | { type: 'weixin-code', code: string }
export type Reply = { ok: true, snapshot: RuntimeSnapshot } | { ok: false, error: string }
export const command = defineInvokeEventa<Reply, { command: Command }>('anna:command')
export const runtimeEvent = defineEventa<AnnaEvent>('anna:event')
export interface AnnaBridge {
  invoke: (command: Command) => Promise<Reply>
  subscribe: (listener: (event: AnnaEvent) => void) => () => void
}
