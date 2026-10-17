import type { DetectEnvironment } from '../packages/agents/detect'
import { describe, expect, it } from 'vitest'
import { detectAgents } from '../packages/agents/detect'

/** A fake machine: the files that exist, the directories that can be listed, and what each command prints. */
function machine(files: string[], commands: Record<string, { stdout: string, code?: number }>, env: Record<string, string> = {}): DetectEnvironment {
  const set = new Set(files)
  return {
    platform: 'darwin',
    home: '/Users/a',
    env: { PATH: '/usr/bin:/bin', ...env },
    exists: path => set.has(path) || files.some(file => file.startsWith(`${path}/`)),
    list: dir => [...new Set(files.filter(file => file.startsWith(`${dir}/`)).map(file => file.slice(dir.length + 1).split('/')[0]!))],
    run: async (command, args) => commands[`${command} ${args.join(' ')}`] ?? { stdout: '', code: 127 },
  }
}

describe('detectAgents', () => {
  it('finds CLIs outside the GUI PATH (~/.local/bin, fnm) and reports version, login and tier', async () => {
    const claude = '/Users/a/.local/bin/claude'
    const codex = '/Users/a/.local/share/fnm/node-versions/v26.7.0/installation/bin/codex'
    const agents = await detectAgents(machine([claude, codex, '/Users/a/.claude/settings.json', '/Users/a/.codex/config.toml'], {
      [`${claude} --version`]: { stdout: '2.1.302 (Claude Code)\n' },
      [`${claude} auth status`]: { stdout: '{\n  "loggedIn": true,\n  "authMethod": "claude.ai"\n}' },
      [`${codex} --version`]: { stdout: 'codex-cli 0.160.0\n' },
      [`${codex} login status`]: { stdout: 'Logged in using ChatGPT\n' },
    }))
    const byId = Object.fromEntries(agents.map(agent => [agent.id, agent]))
    expect(byId.claude).toMatchObject({ installed: true, path: claude, version: '2.1.302', loggedIn: true, tier: 'delegate', configured: true })
    expect(byId.codex).toMatchObject({ installed: true, path: codex, version: '0.160.0', loggedIn: true, tier: 'delegate' })
    expect(byId.gemini).toMatchObject({ installed: false, tier: 'delegate' })
    expect(byId['claude-desktop']).toMatchObject({ tier: 'switch' })
    expect(agents.map(agent => agent.id)).toEqual(['claude', 'codex', 'gemini', 'opencode', 'pi', 'claude-desktop', 'grok', 'openclaw', 'hermes', 'mcode'])
  })
})

describe('detectAgents on Windows and when signed out', () => {
  it('finds npm .cmd shims under %APPDATA%\\npm and reports a signed-out CLI', async () => {
    const codex = 'C:\\Users\\a\\AppData\\Roaming\\npm\\codex.cmd'
    const env = machine([codex], {
      [`${codex} --version`]: { stdout: 'codex-cli 0.161.0' },
      [`${codex} login status`]: { stdout: 'Not logged in', code: 1 },
    }, { PATH: 'C:\\Windows\\System32', APPDATA: 'C:\\Users\\a\\AppData\\Roaming' })
    const agents = await detectAgents({ ...env, platform: 'win32', home: 'C:\\Users\\a' })
    expect(agents.find(agent => agent.id === 'codex')).toMatchObject({ installed: true, path: codex, version: '0.161.0', loggedIn: false })
  })
})
