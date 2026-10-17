/**
 * The agents Anna recognises, mirroring cc-switch's app list (https://github.com/farion1231/cc-switch, MIT).
 * `delegate` agents have a documented headless JSON stream Anna can drive; `switch` agents are only detected
 * and can have their provider switched.
 */
export type AgentId = 'claude' | 'codex' | 'gemini' | 'opencode' | 'pi' | 'claude-desktop' | 'grok' | 'openclaw' | 'hermes' | 'mcode'
export type AgentTier = 'delegate' | 'switch'

export interface AgentDescriptor {
  id: AgentId
  label: string
  tier: AgentTier
  /** Executable names to look for; empty for desktop apps. */
  binaries: string[]
  /** Config directory relative to home (per platform when it differs). */
  configDir: string | Partial<Record<NodeJS.Platform | 'default', string>>
  /** Files whose presence (never contents) means the agent has been configured. */
  configFiles: string[]
  /** Command that reports login status without Anna reading credentials. */
  loginCheck?: { args: string[], loggedIn: (stdout: string, code: number) => boolean }
  /** Install or upgrade command (shown to and confirmed by the user before running). */
  install?: string
  update?: string[]
  /** Desktop app bundle paths (relative to home or absolute). */
  appPaths?: string[]
}

export const catalog: AgentDescriptor[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    tier: 'delegate',
    binaries: ['claude'],
    configDir: '.claude',
    configFiles: ['settings.json'],
    loginCheck: { args: ['auth', 'status'], loggedIn: stdout => /"loggedIn"\s*:\s*true/.test(stdout) },
    install: 'npm i -g @anthropic-ai/claude-code@latest',
    update: ['update'],
  },
  {
    id: 'codex',
    label: 'Codex',
    tier: 'delegate',
    binaries: ['codex'],
    configDir: '.codex',
    configFiles: ['config.toml', 'auth.json'],
    loginCheck: { args: ['login', 'status'], loggedIn: (stdout, code) => code === 0 && /logged in/i.test(stdout) && !/not logged in/i.test(stdout) },
    install: 'npm i -g @openai/codex@latest',
    update: ['update'],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    tier: 'delegate',
    binaries: ['gemini'],
    configDir: '.gemini',
    configFiles: ['settings.json', '.env', 'oauth_creds.json'],
    install: 'npm i -g @google/gemini-cli@latest',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    tier: 'delegate',
    binaries: ['opencode'],
    configDir: '.config/opencode',
    configFiles: ['opencode.json', 'opencode.jsonc'],
    install: 'npm i -g opencode-ai@latest',
    update: ['upgrade'],
  },
  {
    id: 'pi',
    label: 'Pi',
    tier: 'delegate',
    binaries: ['pi'],
    configDir: '.pi/agent',
    configFiles: ['settings.json', 'models.json', 'auth.json'],
    install: 'npm i -g @earendil-works/pi-coding-agent@latest',
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    tier: 'switch',
    binaries: [],
    configDir: { darwin: 'Library/Application Support/Claude', win32: 'AppData/Roaming/Claude', default: '.config/Claude' },
    configFiles: ['claude_desktop_config.json'],
    appPaths: ['/Applications/Claude.app', 'Applications/Claude.app'],
  },
  {
    id: 'grok',
    label: 'Grok Build',
    tier: 'switch',
    binaries: ['grok'],
    configDir: '.grok',
    configFiles: ['config.toml'],
    install: 'npm i -g @xai-official/grok@latest',
    update: ['update'],
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    tier: 'switch',
    binaries: ['openclaw'],
    configDir: '.openclaw',
    configFiles: ['openclaw.json'],
    install: 'npm i -g openclaw@latest',
    update: ['update', '--yes'],
  },
  {
    id: 'hermes',
    label: 'Hermes',
    tier: 'switch',
    binaries: ['hermes'],
    configDir: { win32: 'AppData/Local/hermes', default: '.hermes' },
    configFiles: ['config.yaml'],
    update: ['update'],
  },
  {
    id: 'mcode',
    label: 'MiniMax Code',
    tier: 'switch',
    binaries: ['mcode'],
    configDir: '.minimax',
    configFiles: ['config.yaml'],
    install: 'npm i -g @minimax-ai/code@latest',
  },
]

export function configDirOf(agent: AgentDescriptor, platform: NodeJS.Platform) {
  return typeof agent.configDir === 'string' ? agent.configDir : agent.configDir[platform] ?? agent.configDir.default!
}
