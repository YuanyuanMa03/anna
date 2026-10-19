import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { globalPlan } from '../packages/agents/global'
import { findPreset } from '../packages/agents/providers'

/** Windows keeps no Unix permission bits: a writable file always reports 0o666. */
const unixModes = process.platform !== 'win32'

const deepseek = { preset: findPreset('claude', 'DeepSeek')!, key: 'sk-ds' }

describe('globalPlan: only connection fields change, everything else in the user\'s config survives', () => {
  it('claude settings.json: replaces ANTHROPIC_* env, keeps other keys, env vars and indentation', () => {
    const original = JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, env: { FOO: '1', ANTHROPIC_BASE_URL: 'https://old.example', ANTHROPIC_AUTH_TOKEN: 'old', CLAUDE_CODE_USE_BEDROCK: '1' }, model: 'opus' }, null, 4)
    const { writes } = globalPlan('claude', { 'settings.json': original }, deepseek)
    const next = JSON.parse(writes['settings.json']!)
    expect(next.permissions).toEqual({ allow: ['Bash(ls)'] })
    expect(next.model).toBe('opus')
    expect(next.env.FOO).toBe('1')
    expect(next.env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(next.env.ANTHROPIC_BASE_URL).toMatch(/deepseek/)
    expect(next.env[deepseek.preset.keyField!]).toBe('sk-ds')
    expect(writes['settings.json']!.split('\n')[1]).toMatch(/^ {4}"/)
  })

  it('claude: switching back to the official preset clears the connection fields only', () => {
    const original = JSON.stringify({ env: { FOO: '1', ANTHROPIC_BASE_URL: 'x', ANTHROPIC_AUTH_TOKEN: 'y' } }, null, 2)
    const next = JSON.parse(globalPlan('claude', { 'settings.json': original }, { preset: findPreset('claude', 'Claude Official')! }).writes['settings.json']!)
    expect(next.env).toEqual({ FOO: '1' })
  })

  it('refuses to rewrite files it cannot parse safely (JSON with comments, broken JSON)', () => {
    expect(() => globalPlan('claude', { 'settings.json': '{\n  // comment\n  "env": {}\n}' }, deepseek)).toThrow(/无法安全解析/)
    expect(() => globalPlan('claude', { 'settings.json': '{ "env": ' }, deepseek)).toThrow(/无法安全解析/)
  })

  it('codex config.toml: sets the provider keys and table, keeps comments and unrelated tables; key goes to auth.json', () => {
    const original = '# my settings\nmodel = "o3"\napproval_policy = "on-request"\n\n[mcp_servers.docs]\ncommand = "docs-mcp"\n\n[model_providers.custom]\nname = "old"\nbase_url = "https://old"\n'
    const openrouter = findPreset('codex', 'OpenRouter')!
    const { writes } = globalPlan('codex', { 'config.toml': original, 'auth.json': '{"tokens":{"id_token":"x"}}' }, { preset: openrouter, key: 'sk-or' })
    const toml = writes['config.toml']!
    expect(toml).toContain('# my settings')
    expect(toml).toContain('approval_policy = "on-request"')
    expect(toml).toContain('[mcp_servers.docs]\ncommand = "docs-mcp"')
    expect(toml).toMatch(/^model_provider = "custom"$/m)
    expect(toml).toMatch(new RegExp(`^model = "${openrouter.model}"$`, 'm'))
    expect(toml).not.toContain('model = "o3"')
    expect(toml).toContain(`base_url = "${openrouter.baseUrl}"`)
    expect(toml).not.toContain('https://old')
    expect(toml.indexOf('model_provider')).toBeLessThan(toml.indexOf('[mcp_servers.docs]'))
    expect(JSON.parse(writes['auth.json']!)).toEqual({ OPENAI_API_KEY: 'sk-or' })
  })

  it('gemini: .env connection keys replaced (comments and other vars kept), settings.json auth type set', () => {
    const preset = findPreset('gemini', 'OpenRouter')!
    const { writes } = globalPlan('gemini', { '.env': '# notes\nGEMINI_SANDBOX=docker\nGOOGLE_API_KEY=old\n', 'settings.json': '{\n  "theme": "dark"\n}' }, { preset, key: 'gk' })
    expect(writes['.env']).toContain('# notes')
    expect(writes['.env']).toContain('GEMINI_SANDBOX=docker')
    expect(writes['.env']).not.toContain('GOOGLE_API_KEY=old')
    expect(writes['.env']).toContain('GEMINI_API_KEY=gk')
    expect(JSON.parse(writes['settings.json']!)).toEqual({ theme: 'dark', security: { auth: { selectedType: 'gemini-api-key' } } })
  })
})

describe('globalSwitcher: first-write backup, verified writes, restore', () => {
  it('backs up the original once, applies, and restores byte-for-byte (removing files that did not exist)', async () => {
    const { mkdtemp, readFile, writeFile, mkdir } = await import('node:fs/promises')
    const { existsSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { GlobalSwitcher } = await import('../packages/agents/global')
    const root = await mkdtemp(join(tmpdir(), 'anna-global-'))
    const codexDir = join(root, '.codex')
    await mkdir(codexDir)
    const original = '# keep me\nmodel = "o3"\n'
    await writeFile(join(codexDir, 'config.toml'), original)
    const switcher = new GlobalSwitcher(join(root, 'anna-data', 'agent-backups'), { codex: codexDir, claude: join(root, '.claude'), gemini: join(root, '.gemini') })
    const openrouter = findPreset('codex', 'OpenRouter')!
    await switcher.apply('codex', { preset: openrouter, key: 'k1' })
    await switcher.apply('codex', { preset: openrouter, key: 'k2' })
    expect(await readFile(join(codexDir, 'config.toml'), 'utf8')).toContain('[model_providers.custom]')
    expect(JSON.parse(await readFile(join(codexDir, 'auth.json'), 'utf8'))).toEqual({ OPENAI_API_KEY: 'k2' })
    expect(switcher.status('codex')).toMatchObject({ switched: true, provider: 'OpenRouter' })
    await switcher.restore('codex')
    expect(await readFile(join(codexDir, 'config.toml'), 'utf8')).toBe(original)
    expect(existsSync(join(codexDir, 'auth.json'))).toBe(false)
    expect(switcher.status('codex')).toMatchObject({ switched: false })
  })

  it('a config changed after the switch keeps those changes on restore; only the connection fields go back', async () => {
    const { mkdtemp, readFile, writeFile, mkdir, stat, chmod } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { GlobalSwitcher } = await import('../packages/agents/global')
    const root = await mkdtemp(join(tmpdir(), 'anna-global-'))
    const dirs = { codex: join(root, '.codex'), claude: join(root, '.claude'), gemini: join(root, '.gemini') }
    for (const dir of Object.values(dirs)) await mkdir(dir)
    await writeFile(join(dirs.codex, 'config.toml'), 'model = "o3"\nweb_search = "live"\n')
    await chmod(join(dirs.codex, 'config.toml'), 0o644)
    await writeFile(join(dirs.codex, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-mine' }))
    await writeFile(join(dirs.claude, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'sk-claude' } }))
    const switcher = new GlobalSwitcher(join(root, 'anna-data', 'agent-backups'), dirs)
    await switcher.apply('codex', { preset: findPreset('codex', 'MiniMax')!, key: 'k1' })
    await switcher.apply('claude', { preset: findPreset('claude', 'DeepSeek')!, key: 'k2' })
    expect((await stat(join(dirs.codex, 'config.toml'))).mode & 0o777).toBe(unixModes ? 0o644 : 0o666)
    // Meanwhile: Codex trusts a folder and gets an MCP server, a ChatGPT login lands in auth.json, Claude Code adds a rule.
    await writeFile(join(dirs.codex, 'config.toml'), `${await readFile(join(dirs.codex, 'config.toml'), 'utf8')}\n[projects."/work"]\ntrust_level = "trusted"\n\n[mcp_servers.docs]\ncommand = "docs"\n`)
    await writeFile(join(dirs.codex, 'auth.json'), JSON.stringify({ ...JSON.parse(await readFile(join(dirs.codex, 'auth.json'), 'utf8')), tokens: { id_token: 'login' } }))
    const claude = JSON.parse(await readFile(join(dirs.claude, 'settings.json'), 'utf8'))
    await writeFile(join(dirs.claude, 'settings.json'), JSON.stringify({ ...claude, permissions: { allow: ['Bash(ls)'] } }))
    await switcher.restore('codex')
    await switcher.restore('claude')
    const config = await readFile(join(dirs.codex, 'config.toml'), 'utf8')
    expect(config).toContain('model = "o3"\nweb_search = "live"')
    expect(config).toContain('[projects."/work"]\ntrust_level = "trusted"')
    expect(config).toContain('[mcp_servers.docs]')
    expect(config).not.toMatch(/model_provider|minimax|web_search = "disabled"/i)
    expect((await stat(join(dirs.codex, 'config.toml'))).mode & 0o777).toBe(unixModes ? 0o644 : 0o666)
    expect(JSON.parse(await readFile(join(dirs.codex, 'auth.json'), 'utf8'))).toEqual({ OPENAI_API_KEY: 'sk-mine', tokens: { id_token: 'login' } })
    expect(JSON.parse(await readFile(join(dirs.claude, 'settings.json'), 'utf8'))).toEqual({ env: { ANTHROPIC_AUTH_TOKEN: 'sk-claude' }, permissions: { allow: ['Bash(ls)'] } })
  })
})
