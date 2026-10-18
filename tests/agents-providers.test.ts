import { describe, expect, it } from 'vitest'
import { globalPlan } from '../packages/agents/global'
import { chatRouteOf, findPreset, providerLaunch } from '../packages/agents/providers'

describe('providerLaunch: a provider for one delegated run, without touching any config file', () => {
  it('claude: endpoint and models via ANTHROPIC_* env, key in the preset key field', () => {
    const deepseek = findPreset('claude', 'DeepSeek')!
    const launch = providerLaunch('claude', { preset: deepseek, key: 'sk-test-123' })
    expect(launch.env.ANTHROPIC_BASE_URL).toMatch(/^https:\/\/api\.deepseek\.com/)
    expect(launch.env.ANTHROPIC_MODEL).toBeTruthy()
    expect(launch.env[deepseek.keyField!]).toBe('sk-test-123')
    expect(launch.args).toEqual([])
  })

  it('codex: a custom model provider through -c overrides, key only through an env var', () => {
    const openrouter = findPreset('codex', 'OpenRouter')!
    const launch = providerLaunch('codex', { preset: openrouter, key: 'sk-or-secret' })
    expect(launch.args).toContain('model_provider="anna"')
    expect(launch.args).toContain(`model_providers.anna.base_url="${openrouter.baseUrl}"`)
    expect(launch.args).toContain('model_providers.anna.env_key="ANNA_PROVIDER_KEY"')
    expect(launch.env.ANNA_PROVIDER_KEY).toBe('sk-or-secret')
    expect(launch.args.join(' ')).not.toContain('sk-or-secret')
  })

  it('official presets use the CLI\'s own login: nothing injected', () => {
    expect(providerLaunch('claude', { preset: findPreset('claude', 'Claude Official')! })).toEqual({ env: {}, args: [] })
    expect(providerLaunch('codex', { preset: findPreset('codex', 'OpenAI Official')! })).toEqual({ env: {}, args: [] })
  })

  it('gemini: base url and model env plus GEMINI_API_KEY', () => {
    const preset = findPreset('gemini', 'OpenRouter')!
    expect(providerLaunch('gemini', { preset, key: 'k' }).env).toMatchObject({ GEMINI_API_KEY: 'k' })
  })
})

describe('importCcSwitch: read-only import of an existing cc-switch install', () => {
  it('reads claude/codex/gemini providers with their keys and the current selection, without writing', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const { mkdtemp, stat } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { importCcSwitch } = await import('../packages/agents/providers')
    const path = join(await mkdtemp(join(tmpdir(), 'ccswitch-')), 'cc-switch.db')
    const db = new DatabaseSync(path)
    db.exec('CREATE TABLE providers (id TEXT NOT NULL, app_type TEXT NOT NULL, name TEXT NOT NULL, settings_config TEXT NOT NULL, website_url TEXT, category TEXT, is_current BOOLEAN NOT NULL DEFAULT 0, PRIMARY KEY (id, app_type))')
    const insert = db.prepare('INSERT INTO providers (id, app_type, name, settings_config, website_url, category, is_current) VALUES (?, ?, ?, ?, ?, ?, ?)')
    insert.run('1', 'claude', 'My GLM', JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic', ANTHROPIC_AUTH_TOKEN: 'glm-key', ANTHROPIC_MODEL: 'glm-5.3' } }), 'https://bigmodel.cn', 'cn_official', 1)
    insert.run('2', 'codex', 'My Router', JSON.stringify({ auth: { OPENAI_API_KEY: 'or-key' }, config: 'model_provider = "custom"\nmodel = "gpt-x"\n\n[model_providers.custom]\nname = "r"\nbase_url = "https://router.example/v1"\nwire_api = "responses"\n' }), null, 'third_party', 0)
    insert.run('3', 'opencode', 'Ignored', '{}', null, null, 0)
    db.close()
    const before = (await stat(path)).mtimeMs
    const imported = importCcSwitch(path)
    expect(imported).toEqual([
      { app: 'claude', name: 'My GLM', current: true, key: 'glm-key', preset: expect.objectContaining({ keyField: 'ANTHROPIC_AUTH_TOKEN', env: { ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic', ANTHROPIC_MODEL: 'glm-5.3' } }) },
      { app: 'codex', name: 'My Router', current: false, key: 'or-key', preset: expect.objectContaining({ baseUrl: 'https://router.example/v1', model: 'gpt-x', wireApi: 'responses' }) },
    ])
    expect((await stat(path)).mtimeMs).toBe(before)
  })

  it('a newer database: a Chat Completions Codex provider keeps its format, reasoning settings and model rows', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { importCcSwitch } = await import('../packages/agents/providers')
    const path = join(await mkdtemp(join(tmpdir(), 'ccswitch-')), 'cc-switch.db')
    const db = new DatabaseSync(path)
    db.exec(`CREATE TABLE providers (id TEXT NOT NULL, app_type TEXT NOT NULL, name TEXT NOT NULL, settings_config TEXT NOT NULL, website_url TEXT, category TEXT, meta TEXT NOT NULL DEFAULT '{}', is_current BOOLEAN NOT NULL DEFAULT 0, PRIMARY KEY (id, app_type))`)
    const insert = db.prepare('INSERT INTO providers (id, app_type, name, settings_config, website_url, category, meta, is_current) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    insert.run('1', 'codex', 'My Chat', JSON.stringify({ auth: { OPENAI_API_KEY: 'chat-key' }, config: 'model = "glm-5.3"\n[model_providers.custom]\nbase_url = "https://chat.example/v1"\n', modelCatalog: { models: [{ model: 'glm-5.3', contextWindow: 200000, reasoningLevels: ['high', 'max'], junk: { a: 1 } }, { model: 42 }] } }), null, 'aggregator', JSON.stringify({ apiFormat: 'openai_chat', codexChatReasoning: { supportsThinking: true, thinkingParam: 'enable_thinking', effortParam: 'reasoning_effort; rm -rf', extra: 1 } }), 1)
    insert.run('2', 'codex', 'Broken meta', JSON.stringify({ config: 'base_url = "https://r.example/v1"\n' }), null, null, '{not json', 0)
    db.close()
    const [chat, broken] = importCcSwitch(path)
    expect(chat!.preset).toEqual({ name: 'My Chat', official: false, category: 'aggregator', baseUrl: 'https://chat.example/v1', model: 'glm-5.3', wireApi: 'responses', apiFormat: 'openai_chat', chatReasoning: { supportsThinking: true, thinkingParam: 'enable_thinking' }, models: [{ model: 'glm-5.3', contextWindow: 200000, reasoningLevels: ['high', 'max'] }] })
    expect(broken!.preset).not.toHaveProperty('apiFormat')
  })
})

describe('provider env from any source is safe to launch with and to write globally', () => {
  const hostile = { name: 'H', official: false, category: 'custom', keyField: 'NODE_OPTIONS', env: { 'ANTHROPIC_BASE_URL': 'https://h.example.com', 'NODE_OPTIONS': '--require /tmp/x.js', 'DYLD_INSERT_LIBRARIES': '/tmp/x.dylib', 'API_TIMEOUT_MS': '600000', 'SPLIT': 'a\nNODE_OPTIONS=--require /tmp/y.js', 'BAD-NAME': 'x' } }
  it('launch: loader vars, multi-line values and odd names dropped; the key only in Claude Code\'s own variable', () => {
    const { env } = providerLaunch('claude', { preset: hostile, key: 'sk-1' })
    expect(env).toEqual({ ANTHROPIC_BASE_URL: 'https://h.example.com', API_TIMEOUT_MS: '600000', ANTHROPIC_AUTH_TOKEN: 'sk-1' })
    expect(providerLaunch('claude', { preset: { ...hostile, keyField: 'ANTHROPIC_API_KEY' }, key: 'sk-1' }).env.ANTHROPIC_API_KEY).toBe('sk-1')
  })
  it('global: the same rules for settings.json and Gemini\'s .env', () => {
    const settings = JSON.parse(globalPlan('claude', { 'settings.json': '{}' }, { preset: hostile, key: 'sk-1' }).writes['settings.json']!)
    expect(settings.env).toEqual({ ANTHROPIC_BASE_URL: 'https://h.example.com', API_TIMEOUT_MS: '600000', ANTHROPIC_AUTH_TOKEN: 'sk-1' })
    const dotenv = globalPlan('gemini', {}, { preset: { ...hostile, env: { GOOGLE_GEMINI_BASE_URL: 'https://g.example.com', SPLIT: 'a\nNODE_OPTIONS=x' } }, key: 'k' }).writes['.env']!
    expect(dotenv).toBe('GOOGLE_GEMINI_BASE_URL=https://g.example.com\nGEMINI_API_KEY=k\n')
  })
})

describe('claude Code on a Chat Completions provider, through Anna\'s routing', () => {
  const groq = findPreset('claude', 'Groq')!
  const route = { baseUrl: 'http://127.0.0.1:4567/claude', token: 'anna-route-abc' }

  it('launch: Claude Code gets the route and its token; the provider\'s address and key stay with Anna', () => {
    expect(groq.apiFormat).toBe('openai_chat')
    expect(() => providerLaunch('claude', { preset: groq, key: 'gsk-real' })).toThrow('local routing')
    const { env } = providerLaunch('claude', { preset: { ...groq, env: { ...groq.env, ANTHROPIC_API_KEY: 'leftover' } }, key: 'gsk-real', model: 'openai/gpt-oss-20b' }, route)
    expect(env).toMatchObject({ ANTHROPIC_BASE_URL: route.baseUrl, ANTHROPIC_AUTH_TOKEN: route.token, ANTHROPIC_MODEL: 'openai/gpt-oss-20b' })
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(JSON.stringify(env)).not.toContain('gsk-real')
    expect(JSON.stringify(env)).not.toContain('api.groq.com')
  })

  it('route: the real address and key, and the model tiers Claude Code asks for', () => {
    expect(chatRouteOf('claude', { preset: groq, key: 'gsk-real' })).toEqual({ client: 'claude', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', key: 'gsk-real', models: { default: groq.env!.ANTHROPIC_MODEL, haiku: groq.env!.ANTHROPIC_DEFAULT_HAIKU_MODEL, sonnet: groq.env!.ANTHROPIC_DEFAULT_SONNET_MODEL, opus: groq.env!.ANTHROPIC_DEFAULT_OPUS_MODEL } })
    expect(chatRouteOf('claude', { preset: groq, model: 'my-model' }).models!.default).toBe('my-model')
  })

  it('global switch: refused until global routing', () => {
    expect(() => globalPlan('claude', { 'settings.json': '{}' }, { preset: groq, key: 'k' })).toThrow('本地路由')
  })

  it('import from cc-switch keeps the format', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { importCcSwitch } = await import('../packages/agents/providers')
    const path = join(await mkdtemp(join(tmpdir(), 'ccswitch-')), 'cc-switch.db')
    const db = new DatabaseSync(path)
    db.exec(`CREATE TABLE providers (id TEXT NOT NULL, app_type TEXT NOT NULL, name TEXT NOT NULL, settings_config TEXT NOT NULL, website_url TEXT, category TEXT, meta TEXT NOT NULL DEFAULT '{}', is_current BOOLEAN NOT NULL DEFAULT 0, PRIMARY KEY (id, app_type))`)
    db.prepare('INSERT INTO providers (id, app_type, name, settings_config, website_url, category, meta, is_current) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('1', 'claude', 'Chat Relay', JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://relay.example.com', ANTHROPIC_AUTH_TOKEN: 'k', ANTHROPIC_MODEL: 'glm-5.3' } }), null, null, JSON.stringify({ apiFormat: 'openai_chat' }), 0)
    db.close()
    expect(importCcSwitch(path)[0]!.preset).toMatchObject({ apiFormat: 'openai_chat', env: { ANTHROPIC_BASE_URL: 'https://relay.example.com', ANTHROPIC_MODEL: 'glm-5.3' } })
  })
})
