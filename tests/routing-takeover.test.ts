import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeRelease, claudeTakeover, codexRelease, codexTakeover, RoutingTakeover } from '../packages/agents/takeover'

/** Global routing writes only the connection fields into the agents' own configs, and puts back only those. */

const target = { url: 'http://127.0.0.1:15722/claude', token: 'anna-route-abc' }

describe('claude Code\'s settings.json', () => {
  const original = `${JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_AUTH_TOKEN: 'sk-mine', ANTHROPIC_MODEL: 'deepseek-v4-pro', API_TIMEOUT_MS: '600000' }, model: 'opus' }, null, 2)}\n`

  it('takes over the connection: route, token, and Claude tier names the routing maps back', () => {
    const { text, originals } = claudeTakeover(original, { ...target, models: { default: 'deepseek-v4-pro[1M]', haiku: 'deepseek-flash[1M]' } })
    const settings = JSON.parse(text)
    expect(settings.env).toEqual({
      API_TIMEOUT_MS: '600000',
      ANTHROPIC_BASE_URL: target.url,
      ANTHROPIC_AUTH_TOKEN: target.token,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-5-5',
      ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: 'deepseek-flash',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5[1M]',
      ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: 'deepseek-v4-pro',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5[1M]',
      ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'deepseek-v4-pro',
    })
    expect(settings.permissions).toEqual({ allow: ['Bash(ls)'] })
    expect(settings.model).toBe('opus')
    expect(originals).toEqual({ env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_AUTH_TOKEN: 'sk-mine', ANTHROPIC_MODEL: 'deepseek-v4-pro' } })
  })

  it('a key helper would replace the route\'s token, so it is set aside too, and comes back', () => {
    const withHelper = JSON.stringify({ apiKeyHelper: '~/bin/key.sh', env: {} })
    const { text, originals } = claudeTakeover(withHelper, { ...target, models: {} })
    expect(JSON.parse(text)).not.toHaveProperty('apiKeyHelper')
    expect(JSON.parse(claudeRelease(text, originals)).apiKeyHelper).toBe('~/bin/key.sh')
  })

  it('giving it back restores those fields and keeps what changed meanwhile', () => {
    const { text, originals } = claudeTakeover(original, { ...target, models: { default: 'x' } })
    const meanwhile = JSON.parse(text)
    meanwhile.permissions.allow.push('Bash(pwd)')
    meanwhile.env.MY_FLAG = '1'
    const back = JSON.parse(claudeRelease(JSON.stringify(meanwhile), originals))
    expect(back.env).toEqual({ API_TIMEOUT_MS: '600000', MY_FLAG: '1', ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_AUTH_TOKEN: 'sk-mine', ANTHROPIC_MODEL: 'deepseek-v4-pro' })
    expect(back.permissions.allow).toEqual(['Bash(ls)', 'Bash(pwd)'])
    expect(JSON.parse(claudeRelease(claudeTakeover(undefined, { ...target, models: {} }).text, { env: {} }))).toEqual({})
  })
})

describe('codex\'s config.toml', () => {
  const original = 'model = "gpt-6"\nmodel_reasoning_effort = "high"\napproval_policy = "on-request"\n\n[mcp_servers.docs]\ncommand = "docs"\n\n[model_providers.custom]\nname = "old"\nbase_url = "https://old.example/v1"\n'

  it('takes over the connection: the route as the custom provider, its token as the bearer token, the model and catalog', () => {
    const { text, originals } = codexTakeover(original, { url: 'http://127.0.0.1:15722/codex/v1', token: 'anna-route-abc', model: 'deepseek-flash', catalogPath: '/home/u/.codex/anna-model-catalog.json' })
    expect(text).toBe('approval_policy = "on-request"\nmodel_provider = "custom"\nmodel = "deepseek-flash"\nmodel_catalog_json = "/home/u/.codex/anna-model-catalog.json"\n\n[mcp_servers.docs]\ncommand = "docs"\n\n[model_providers.custom]\nname = "Anna"\nbase_url = "http://127.0.0.1:15722/codex/v1"\nwire_api = "responses"\nexperimental_bearer_token = "anna-route-abc"\n')
    expect(originals).toEqual({ top: ['model = "gpt-6"', 'model_reasoning_effort = "high"'], table: ['[model_providers.custom]', 'name = "old"', 'base_url = "https://old.example/v1"', ''] })
  })

  it('giving it back restores those lines and keeps what changed meanwhile', () => {
    const { text, originals } = codexTakeover(original, { url: 'u', token: 't' })
    const meanwhile = `${text.replace('[mcp_servers.docs]', '[mcp_servers.docs]\nenabled = false')}\n[projects."/work"]\ntrust_level = "trusted"\n`
    const back = codexRelease(meanwhile, originals)
    expect(back).toContain('model = "gpt-6"\nmodel_reasoning_effort = "high"')
    expect(back).toContain('[mcp_servers.docs]\nenabled = false')
    expect(back).toContain('[projects."/work"]\ntrust_level = "trusted"')
    expect(back).toContain('[model_providers.custom]\nname = "old"\nbase_url = "https://old.example/v1"')
    expect(back).not.toMatch(/anna-route|experimental_bearer_token|model_provider =/)
    expect(codexRelease(codexTakeover('', { url: 'u', token: 't' }).text, { top: [] })).toBe('\n')
  })

  it('refuses a config it can\'t parse safely', () => {
    expect(() => codexTakeover('model_providers = { custom = { name = "x" } }\n', { url: 'u', token: 't' })).toThrow('无法安全解析')
  })
})

describe('the takeover on disk', () => {
  async function dirs() {
    const root = await mkdtemp(join(tmpdir(), 'anna-takeover-'))
    return { root, claude: join(root, 'claude'), codex: join(root, 'codex'), state: join(root, 'state') }
  }

  it('the first originals are kept: renewing after a crash never mistakes Anna\'s own fields for the user\'s', async () => {
    const d = await dirs()
    const original = 'model = "gpt-6"\n'
    await writeFile(join(d.root, 'seed'), '')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(d.codex, { recursive: true })
    await writeFile(join(d.codex, 'config.toml'), original)
    await writeFile(join(d.codex, 'anna-model-catalog.json'), '{"models":[]}\n')
    const first = new RoutingTakeover(d.state, d)
    expect(await first.apply({ app: 'codex', target: { url: 'u', token: 't1', model: 'm1' }, catalog: '{"models":[1]}\n' })).toBe(true)
    // A crash: a new process takes over again (a new model this time).
    const second = new RoutingTakeover(d.state, d)
    expect(await second.active('codex')).toBe(true)
    await second.apply({ app: 'codex', target: { url: 'u', token: 't1', model: 'm2' } })
    expect(await readFile(join(d.codex, 'config.toml'), 'utf8')).toContain('model = "m2"')
    expect(await second.apply({ app: 'codex', target: { url: 'u', token: 't1', model: 'm2' } })).toBe(false)
    await second.release('codex')
    expect(await readFile(join(d.codex, 'config.toml'), 'utf8')).toBe('model = "gpt-6"\n')
    expect(await readFile(join(d.codex, 'anna-model-catalog.json'), 'utf8')).toBe('{"models":[]}\n')
    expect(await second.active('codex')).toBe(false)
  })

  it('a config that didn\'t exist is gone again; one changed meanwhile keeps the changes', async () => {
    const d = await dirs()
    const { existsSync } = await import('node:fs')
    const takeover = new RoutingTakeover(d.state, d)
    await takeover.apply({ app: 'claude', target: { ...target, models: { default: 'm' } } })
    expect(JSON.parse(await readFile(join(d.claude, 'settings.json'), 'utf8')).env.ANTHROPIC_BASE_URL).toBe(target.url)
    await takeover.release('claude')
    expect(existsSync(join(d.claude, 'settings.json'))).toBe(false)
    await takeover.release('claude')
    await takeover.apply({ app: 'claude', target: { ...target, models: { default: 'm' } } })
    const meanwhile = JSON.parse(await readFile(join(d.claude, 'settings.json'), 'utf8'))
    await writeFile(join(d.claude, 'settings.json'), JSON.stringify({ ...meanwhile, theme: 'dark' }))
    await takeover.release('claude')
    expect(JSON.parse(await readFile(join(d.claude, 'settings.json'), 'utf8'))).toEqual({ theme: 'dark' })
  })
})
