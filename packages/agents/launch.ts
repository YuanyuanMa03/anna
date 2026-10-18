import type { PermissionMode } from '../permissions/modes'
import type { DelegateAgent } from './adapters'
import type { ProviderApp, ProviderChoice } from './providers'
import { mcpServerName } from '../kernels/external/mcp'
import { providerLaunch } from './providers'

export interface LaunchInput {
  cwd: string
  prompt: string
  mode: PermissionMode
  /** Continue this agent session. */
  sessionId?: string
  provider?: ProviderChoice
  /** Paths the agent must never read or edit (Anna's own data). */
  denyPaths: string[]
  /** Extra system instructions (Anna's persona when the agent is Anna's brain). */
  instructions?: string
  /** Anna's own tools as a local MCP server (when the agent is Anna's brain). */
  tools?: { url: string, token: string }
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
/** Claude Code rules for a path and everything under it (`//` is an absolute path there). */
function pathRules(path: string) {
  const base = `/${path.replace(/\\/g, '/').replace(/\/$/, '')}`
  return [base, `${base}/**`].flatMap(glob => [`Read(${glob})`, `Edit(${glob})`])
}

/**
 * Claude Code: `--mcp-config` with Anna's tool server; its tools appear as `mcp__anna__anna_*`. A delegation or an
 * approval card can keep a tool busy far longer than Claude Code's default, so the server gets a one-day timeout.
 */
function claudeTools(tools: LaunchInput['tools']) {
  return tools ? ['--mcp-config', JSON.stringify({ mcpServers: { [mcpServerName]: { type: 'http', url: tools.url, headers: { Authorization: `Bearer ${tools.token}` }, timeout: 86_400_000 } } })] : []
}

/**
 * Codex: config overrides for Anna's tool server. Anna's tools decide for themselves when to ask (delegation asks in
 * Plan and Ask, as on the pi brain), so Codex approves them without an elicitation nobody would answer; a delegation
 * can run far longer than Codex's default 60-second tool timeout.
 */
function codexTools(tools: LaunchInput['tools']) {
  if (!tools)
    return []
  const key = `mcp_servers.${mcpServerName}`
  return [`${key}.url=${JSON.stringify(tools.url)}`, `${key}.http_headers={ Authorization = ${JSON.stringify(`Bearer ${tools.token}`)} }`, `${key}.tool_timeout_sec=86400`, `${key}.default_tools_approval_mode="approve"`].flatMap(value => ['-c', value])
}

/**
 * Command-line arguments for one delegated run. Anna's mode maps onto each agent's own approval level;
 * in `auto`, risky calls still reach Anna's gate, which allows the rest without asking.
 */
export function buildLaunch(agent: DelegateAgent, input: LaunchInput): Launch {
  const app = (['claude', 'codex', 'gemini'] as string[]).includes(agent) ? agent as ProviderApp : undefined
  const provider = app && input.provider ? providerLaunch(app, input.provider) : { env: {}, args: [] }
  switch (agent) {
    case 'claude': {
      const deny = input.denyPaths.flatMap(pathRules)
      return {
        args: ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--permission-mode', claudeModes[input.mode], '--settings', JSON.stringify({ permissions: { deny } }), ...(input.instructions ? ['--append-system-prompt', input.instructions] : []), ...claudeTools(input.tools), ...(input.sessionId ? ['--resume', input.sessionId] : [])],
        env: provider.env,
        stdin: [{ type: 'user', message: { role: 'user', content: input.prompt } }],
      }
    }
    case 'codex':
      return {
        args: ['app-server', ...provider.args, ...codexTools(input.tools)],
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
