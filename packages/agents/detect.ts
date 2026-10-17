import type { AgentDescriptor, AgentId, AgentTier } from './catalog'
import { delimiter, join, posix, win32 } from 'node:path'
import { catalog, configDirOf } from './catalog'

/** Everything detection needs from the machine, injectable for tests. */
export interface DetectEnvironment {
  platform: NodeJS.Platform
  home: string
  env: Record<string, string | undefined>
  exists: (path: string) => boolean
  /** Entry names in a directory; empty when missing. */
  list: (dir: string) => string[]
  run: (command: string, args: string[]) => Promise<{ stdout: string, code?: number }>
}

export interface AgentInfo {
  id: AgentId
  label: string
  tier: AgentTier
  installed: boolean
  path?: string
  version?: string
  loggedIn?: boolean
  /** A config file exists in the agent's config directory. */
  configured: boolean
  configDir: string
  install?: string
}

/**
 * Directories a GUI app should search besides PATH: GUI apps on macOS do not inherit the shell's PATH,
 * so version managers (nvm, fnm, volta, mise), package-manager globals and Homebrew must be listed explicitly.
 */
export function searchDirectories(env: DetectEnvironment) {
  const { home, platform } = env
  const path = platform === 'win32' ? win32 : posix
  const dirs: string[] = (env.env.PATH ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean)
  const add = (dir: string) => {
    if (!dirs.includes(dir))
      dirs.push(dir)
  }
  const versions = (root: string, suffix: string) => env.list(root).sort().reverse().forEach(version => add(path.join(root, version, suffix)))
  if (platform === 'win32') {
    const appData = env.env.APPDATA ?? path.join(home, 'AppData/Roaming')
    const local = env.env.LOCALAPPDATA ?? path.join(home, 'AppData/Local')
    for (const dir of [path.join(appData, 'npm'), path.join(local, 'pnpm'), path.join(home, '.bun/bin'), path.join(home, '.volta/bin'), path.join(local, 'Programs')]) add(dir)
    if (env.env.NVM_HOME)
      versions(env.env.NVM_HOME, '')
    versions(path.join(appData, 'fnm/node-versions'), 'installation')
    return dirs
  }
  for (const dir of [path.join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.npm-global/bin'), path.join(home, '.bun/bin'), path.join(home, '.volta/bin'), path.join(home, '.local/share/pnpm'), path.join(home, 'Library/pnpm'), path.join(home, '.asdf/shims'), path.join(home, '.local/share/mise/shims'), path.join(home, '.opencode/bin'), path.join(home, '.grok/bin')]) add(dir)
  versions(path.join(home, '.nvm/versions/node'), 'bin')
  versions(env.env.FNM_DIR ? path.join(env.env.FNM_DIR, 'node-versions') : path.join(home, '.local/share/fnm/node-versions'), 'installation/bin')
  versions(path.join(home, 'Library/Application Support/fnm/node-versions'), 'installation/bin')
  versions(path.join(home, '.local/share/mise/installs/node'), 'bin')
  return dirs
}

function locate(agent: AgentDescriptor, env: DetectEnvironment, dirs: string[]) {
  const path = env.platform === 'win32' ? win32 : posix
  const names = env.platform === 'win32' ? agent.binaries.flatMap(name => [`${name}.cmd`, `${name}.exe`, `${name}.ps1`, name]) : agent.binaries
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (env.exists(candidate))
        return candidate
    }
  }
  for (const app of agent.appPaths ?? []) {
    const candidate = app.startsWith('/') ? app : join(env.home, app)
    if (env.exists(candidate))
      return candidate
  }
}

function parseVersion(stdout: string) {
  return /\d+\.\d+\.\d[-.\w]*/.exec(stdout)?.[0]
}

/** Detect every catalogued agent: install location, version, login state and configuration, without reading credentials. */
export async function detectAgents(env: DetectEnvironment): Promise<AgentInfo[]> {
  const dirs = searchDirectories(env)
  const path = env.platform === 'win32' ? win32 : posix
  return Promise.all(catalog.map(async (agent) => {
    const configDir = path.join(env.home, configDirOf(agent, env.platform))
    const configured = agent.configFiles.some(file => env.exists(path.join(configDir, file)))
    const located = locate(agent, env, dirs)
    const info: AgentInfo = { id: agent.id, label: agent.label, tier: agent.tier, installed: Boolean(located), path: located, configured, configDir, install: agent.install }
    if (!located || agent.binaries.length === 0)
      return info
    const [version, login] = await Promise.all([
      env.run(located, ['--version']).catch(() => ({ stdout: '', code: 1 })),
      agent.loginCheck ? env.run(located, agent.loginCheck.args).catch(() => ({ stdout: '', code: 1 })) : Promise.resolve(undefined),
    ])
    info.version = parseVersion(version.stdout)
    if (agent.loginCheck && login)
      info.loggedIn = agent.loginCheck.loggedIn(login.stdout, login.code ?? 0)
    return info
  }))
}
