/**
 * The agents Anna recognises, mirroring cc-switch's app list (https://github.com/farion1231/cc-switch, MIT) and the
 * agents of the Agent Client Protocol registry (https://github.com/agentclientprotocol/registry).
 * `delegate` agents have a documented headless JSON stream Anna can drive; `switch` agents are only detected
 * and can have their provider switched (cc-switch's apps); `detect` agents are other local agents Anna recognises.
 */
export type AgentId = 'claude' | 'codex' | 'gemini' | 'opencode' | 'pi' | 'claude-desktop' | 'grok' | 'openclaw' | 'hermes' | 'mcode'
  | 'kimi' | 'omp' | 'dsh' | 'agy' | 'qwen' | 'cursor' | 'copilot' | 'goose' | 'droid' | 'auggie' | 'codebuddy' | 'qoder' | 'cline' | 'kilo'
export type AgentTier = 'delegate' | 'switch' | 'detect'

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
  /** Arguments that start the installed agent as an Agent Client Protocol server, so it can be Anna's brain (from the ACP registry). */
  acp?: string[]
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
    acp: ['--acp'],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    tier: 'delegate',
    binaries: ['opencode'],
    configDir: '.config/opencode',
    configFiles: ['opencode.json', 'opencode.jsonc'],
    install: 'npm i -g opencode-ai@latest',
    acp: ['acp'],
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
    acp: ['agent', 'stdio'],
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
    acp: ['acp'],
  },
  // cc-switch's newer apps: config locations from its *_config.rs, install and update commands from its misc.rs.
  {
    id: 'kimi',
    label: 'Kimi Code',
    tier: 'switch',
    binaries: ['kimi'],
    configDir: '.kimi-code',
    configFiles: ['config.toml'],
    install: 'npm i -g @moonshot-ai/kimi-code@latest',
    acp: ['acp'],
    update: ['upgrade', '--yes'],
  },
  {
    id: 'omp',
    label: 'Oh My Pi',
    tier: 'switch',
    binaries: ['omp'],
    configDir: '.omp/agent',
    configFiles: ['models.yml', 'config.yml'],
    install: 'curl -fsSL https://omp.sh/install | sh',
    update: ['update'],
  },
  {
    id: 'dsh',
    label: 'DeepSeek Harness',
    tier: 'switch',
    binaries: ['dsh'],
    configDir: '.dsh',
    configFiles: ['profiles'],
    install: 'npm i -g @deepseek-ai/dsh@latest --engine-strict',
  },
  {
    id: 'agy',
    label: 'Antigravity CLI',
    tier: 'switch',
    binaries: ['agy'],
    configDir: '.gemini/antigravity-cli',
    configFiles: ['settings.json'],
    install: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    update: ['update'],
  },
  // Other local agents in the ACP registry. Only the executable is certain for some; their config files stay empty.
  { id: 'qwen', label: 'Qwen Code', tier: 'detect', binaries: ['qwen'], configDir: '.qwen', configFiles: ['settings.json'], install: 'npm i -g @qwen-code/qwen-code@latest', acp: ['--acp'] },
  { id: 'cursor', label: 'Cursor CLI', tier: 'detect', binaries: ['cursor-agent'], configDir: '.cursor', configFiles: ['cli-config.json'], install: 'curl https://cursor.com/install -fsS | bash', acp: ['acp'] },
  { id: 'copilot', label: 'GitHub Copilot CLI', tier: 'detect', binaries: ['copilot'], configDir: '.copilot', configFiles: ['config.json'], install: 'npm i -g @github/copilot@latest', acp: ['--acp'] },
  { id: 'goose', label: 'Goose', tier: 'detect', binaries: ['goose'], configDir: { win32: 'AppData/Roaming/Block/goose/config', default: '.config/goose' }, configFiles: ['config.yaml'], acp: ['acp'] },
  { id: 'droid', label: 'Factory Droid', tier: 'detect', binaries: ['droid'], configDir: '.factory', configFiles: [], install: 'npm i -g droid@latest', acp: ['exec', '--output-format', 'acp-daemon'] },
  { id: 'auggie', label: 'Auggie', tier: 'detect', binaries: ['auggie'], configDir: '.augment', configFiles: [], install: 'npm i -g @augmentcode/auggie@latest', acp: ['--acp'] },
  { id: 'codebuddy', label: 'CodeBuddy Code', tier: 'detect', binaries: ['codebuddy'], configDir: '.codebuddy', configFiles: [], install: 'npm i -g @tencent-ai/codebuddy-code@latest', acp: ['--acp'] },
  { id: 'qoder', label: 'Qoder CLI', tier: 'detect', binaries: ['qodercli'], configDir: '.qoder', configFiles: [], install: 'npm i -g @qoder-ai/qodercli@latest', acp: ['--acp'] },
  { id: 'cline', label: 'Cline', tier: 'detect', binaries: ['cline'], configDir: '.cline', configFiles: [], install: 'npm i -g cline@latest', acp: ['--acp'] },
  { id: 'kilo', label: 'Kilo', tier: 'detect', binaries: ['kilo'], configDir: '.kilocode', configFiles: [], install: 'npm i -g @kilocode/cli@latest', acp: ['acp'] },
]

/** Anna runs an install command herself only when it is a plain global npm install; pipes and other package managers need a shell. */
export function autoInstallable(install: string) {
  return /^npm i(?:nstall)? -g [@\w/.-]+(?: --[\w-]+)*$/.test(install)
}

export function configDirOf(agent: AgentDescriptor, platform: NodeJS.Platform) {
  return typeof agent.configDir === 'string' ? agent.configDir : agent.configDir[platform] ?? agent.configDir.default!
}
