import { describe, expect, it } from 'vitest'
import { buildLaunch } from '../packages/agents/launch'
import { findPreset } from '../packages/agents/providers'

const base = { cwd: '/w', prompt: '修复登录 bug', denyPaths: ['/Users/a/.ssh', '/Users/a/.aws'] }

describe('buildLaunch: Anna mode, provider and session → each agent\'s own flags', () => {
  it('claude: stream-json with stdio permission prompts, mode mapping, deny rules, resume', () => {
    const launch = buildLaunch('claude', { ...base, mode: 'edit', sessionId: 's-1' })
    expect(launch.args).toEqual(expect.arrayContaining(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--resume', 's-1']))
    expect(launch.args[launch.args.indexOf('--permission-mode') + 1]).toBe('acceptEdits')
    const settings = JSON.parse(launch.args[launch.args.indexOf('--settings') + 1]!)
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(['Read(//Users/a/.ssh/**)', 'Edit(//Users/a/.aws/**)']))
    expect(launch.stdin[0]).toMatchObject({ type: 'user', message: { role: 'user', content: '修复登录 bug' } })
    expect(buildLaunch('claude', { ...base, mode: 'plan' }).args).toContain('plan')
  })

  it('codex: app-server, approval and sandbox from the mode, provider via -c and env', () => {
    const launch = buildLaunch('codex', { ...base, mode: 'plan', provider: { preset: findPreset('codex', 'OpenRouter')!, key: 'k' } })
    expect(launch.args[0]).toBe('app-server')
    expect(launch.args).toContain('model_provider="anna"')
    expect(launch.env.ANNA_PROVIDER_KEY).toBe('k')
    expect(launch.thread).toEqual({ approvalPolicy: 'untrusted', sandbox: 'read-only' })
    expect(buildLaunch('codex', { ...base, mode: 'edit' }).thread).toEqual({ approvalPolicy: 'on-request', sandbox: 'workspace-write' })
  })

  it('upfront agents get their own approval level from the mode', () => {
    expect(buildLaunch('gemini', { ...base, mode: 'edit' }).args).toEqual(expect.arrayContaining(['-p', '修复登录 bug', '--output-format', 'stream-json', '--approval-mode', 'auto_edit']))
    expect(buildLaunch('gemini', { ...base, mode: 'ask', sessionId: 'g1' }).args).toEqual(expect.arrayContaining(['--approval-mode', 'default', '--resume', 'g1']))
    expect(buildLaunch('opencode', { ...base, mode: 'auto' }).args).toEqual(expect.arrayContaining(['run', '--format', 'json', '--auto', '--dir', '/w']))
    expect(buildLaunch('opencode', { ...base, mode: 'ask' }).args).not.toContain('--auto')
    expect(buildLaunch('pi', { ...base, mode: 'plan', sessionId: 'p1' }).args).toEqual(expect.arrayContaining(['--mode', 'json', '--tools', 'read,grep,find,ls', '--session-id', 'p1']))
  })
})
