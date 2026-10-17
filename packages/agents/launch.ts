import type { PermissionMode } from '../permissions/modes'
import type { DelegateAgent } from './adapters'
import type { ProviderApp, ProviderChoice } from './providers'
import { providerLaunch } from './providers'

export interface LaunchInput {
  cwd: string
  prompt: string
  mode: PermissionMode
  /** Continue this agent session. */
  sessionId?: string
  provider?: ProviderChoice
  /** Paths the agent must never read or edit (credentials, Anna's own data). */
  denyPaths: string[]
  /** Extra system instructions (Anna's persona when the agent is Anna's brain). */
  instructions?: string
}

export interface Launch {
  args: string[]
  env: Record<string, string>
  /** JSON lines to write to stdin right after start (stream-json input). */
  stdin: object[]
  /** codex: the turn's text (sent over JSON-RPC rather than argv). */
  prompt?: string
  /** codex app-server thread settings. */
  thread?: { approvalPolicy: 'untrusted' | 'on-request' | 'never', sandbox: 'read-only' | 'workspace-write', developerInstructions?: string }
}

const claudeModes: Record<PermissionMode, string> = { plan: 'plan', ask: 'default', edit: 'acceptEdits', auto: 'acceptEdits' }
const geminiModes: Record<PermissionMode, string> = { plan: 'default', ask: 'default', edit: 'auto_edit', auto: 'auto_edit' }
const ruleGlob = (path: string) => `/${path.replace(/\\/g, '/').replace(/\/$/, '')}/**`

/**
 * Command-line arguments for one delegated run. Anna's mode maps onto each agent's own approval level;
 * in `auto`, risky calls still reach Anna's gate, which allows the rest without asking.
 */
export function buildLaunch(agent: DelegateAgent, input: LaunchInput): Launch {
  const app = (['claude', 'codex', 'gemini'] as string[]).includes(agent) ? agent as ProviderApp : undefined
  const provider = app && input.provider ? providerLaunch(app, input.provider) : { env: {}, args: [] }
  switch (agent) {
    case 'claude': {
      const deny = input.denyPaths.flatMap(path => [`Read(${ruleGlob(path)})`, `Edit(${ruleGlob(path)})`])
      return {
        args: ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--permission-mode', claudeModes[input.mode], '--settings', JSON.stringify({ permissions: { deny } }), ...(input.instructions ? ['--append-system-prompt', input.instructions] : []), ...(input.sessionId ? ['--resume', input.sessionId] : [])],
        env: provider.env,
        stdin: [{ type: 'user', message: { role: 'user', content: input.prompt } }],
      }
    }
    case 'codex':
      return {
        args: ['app-server', ...provider.args],
        env: provider.env,
        stdin: [],
        prompt: input.prompt,
        thread: { ...(input.mode === 'plan' ? { approvalPolicy: 'untrusted', sandbox: 'read-only' } as const : input.mode === 'ask' ? { approvalPolicy: 'untrusted', sandbox: 'workspace-write' } as const : { approvalPolicy: 'on-request', sandbox: 'workspace-write' } as const), ...(input.instructions ? { developerInstructions: input.instructions } : {}) },
      }
    case 'gemini':
      return { args: ['-p', input.prompt, '--output-format', 'stream-json', '--approval-mode', geminiModes[input.mode], ...(input.sessionId ? ['--resume', input.sessionId] : [])], env: provider.env, stdin: [] }
    case 'opencode':
      return { args: ['run', '--format', 'json', '--dir', input.cwd, ...(input.mode === 'edit' || input.mode === 'auto' ? ['--auto'] : []), ...(input.sessionId ? ['--session', input.sessionId] : []), input.prompt], env: {}, stdin: [] }
    case 'pi':
      return { args: ['--mode', 'json', ...(input.mode === 'plan' || input.mode === 'ask' ? ['--tools', 'read,grep,find,ls'] : []), ...(input.sessionId ? ['--session-id', input.sessionId] : []), input.prompt], env: {}, stdin: [] }
  }
}
