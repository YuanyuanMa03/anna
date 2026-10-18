import { Buffer } from 'node:buffer'
import { expect, it } from 'vitest'
import { maskKey, parseProviderLink } from '../packages/agents/deeplink'

const link = (params: Record<string, string>, scheme = 'ccswitch') => `${scheme}://v1/import?${new URLSearchParams({ resource: 'provider', ...params })}`

it('reads cc-switch\'s provider links (and the same as anna://): endpoints, key, models, homepage', () => {
  expect(parseProviderLink(link({ app: 'claude', name: 'Example AI', endpoint: 'https://api.example.com/,https://backup.example.com', apiKey: 'sk-abcdef123456', model: 'ex-1', haikuModel: 'ex-mini', homepage: 'https://example.com', enabled: 'true' }))).toEqual({
    app: 'claude',
    name: 'Example AI',
    baseUrl: 'https://api.example.com',
    endpoints: ['https://backup.example.com'],
    key: 'sk-abcdef123456',
    model: 'ex-1',
    tiers: { haiku: 'ex-mini', sonnet: undefined, opus: undefined },
    env: undefined,
    website: 'https://example.com',
    enabled: true,
    warnings: [],
  })
  expect(parseProviderLink(link({ app: 'codex', name: 'Relay', endpoint: 'https://relay.example.com/v1', apiKey: 'k1' }, 'anna'))).toMatchObject({ app: 'codex', baseUrl: 'https://relay.example.com/v1', enabled: false })
})

it('an embedded config fills in what the URL leaves out; extra env vars are pointed out, the URL wins', () => {
  const config = Buffer.from(JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://cfg.example.com', ANTHROPIC_AUTH_TOKEN: 'sk-from-config', API_TIMEOUT_MS: '600000' } })).toString('base64url')
  const parsed = parseProviderLink(link({ app: 'claude', name: 'Cfg', config, model: 'url-model' }))
  expect(parsed).toMatchObject({ baseUrl: 'https://cfg.example.com', key: 'sk-from-config', model: 'url-model', env: { API_TIMEOUT_MS: '600000' } })
  expect(parsed.warnings).toEqual(['还会设置环境变量：API_TIMEOUT_MS'])
  const toml = Buffer.from('model = "gpt-x"\n[model_providers.custom]\nbase_url = "https://t.example.com/v1"\n').toString('base64')
  expect(parseProviderLink(link({ app: 'codex', name: 'T', config: toml, configFormat: 'toml', apiKey: 'k' }))).toMatchObject({ baseUrl: 'https://t.example.com/v1', model: 'gpt-x' })
})

it('refuses what Anna can\'t or shouldn\'t take, with the reason', () => {
  const bad = (params: Record<string, string>, raw?: string) => () => parseProviderLink(raw ?? link(params))
  expect(bad({}, 'https://example.com/import')).toThrow('anna://')
  expect(bad({}, 'ccswitch://v2/import?resource=provider')).toThrow('v1/import')
  expect(bad({ resource: 'mcp' })).toThrow('下一阶段')
  expect(bad({ app: 'opencode', name: 'x', endpoint: 'https://a.example.com', apiKey: 'k' })).toThrow('opencode')
  expect(bad({ app: 'claude', name: 'x', endpoint: 'https://a.example.com', apiKey: 'k', apiFormat: 'openai_chat' })).toThrow('本地路由')
  expect(bad({ app: 'codex', name: 'x', endpoint: 'https://a.example.com', apiKey: 'k', apiFormat: 'anthropic' })).toThrow('本地路由')
  expect(bad({ app: 'claude', name: 'x', endpoint: 'https://a.example.com' })).toThrow('API Key')
  expect(bad({ app: 'claude', name: 'x', endpoint: 'https://a.example.com', apiKey: 'k', configUrl: 'https://evil.example.com/c.json' })).toThrow('远程')
  const loader = Buffer.from(JSON.stringify({ env: { NODE_OPTIONS: '--require /tmp/x.js', ANTHROPIC_AUTH_TOKEN: 'k' } })).toString('base64')
  expect(bad({ app: 'claude', name: 'x', endpoint: 'https://a.example.com', config: loader })).toThrow('NODE_OPTIONS')
  expect(bad({ app: 'claude', name: 'x', endpoint: 'javascript:alert(1)', apiKey: 'k' })).toThrow('请求地址无效')
})

it('takes a Chat Completions provider for Codex, which goes through Anna\'s local routing', () => {
  expect(parseProviderLink(link({ app: 'codex', name: 'C', endpoint: 'https://c.example.com/v1', apiKey: 'k', model: 'glm-5.3', apiFormat: 'openai_chat' }))).toMatchObject({ app: 'codex', baseUrl: 'https://c.example.com/v1', apiFormat: 'openai_chat' })
  expect(parseProviderLink(link({ app: 'codex', name: 'R', endpoint: 'https://r.example.com/v1', apiKey: 'k' }))).not.toHaveProperty('apiFormat')
})

it('points out local and private-network addresses; masks keys', () => {
  expect(parseProviderLink(link({ app: 'gemini', name: 'L', endpoint: 'http://192.168.1.9:8080', apiKey: 'k' })).warnings).toEqual(['请求地址指向本机或局域网'])
  expect(maskKey('sk-abcdef123456')).toBe('sk-a••••3456')
  expect(maskKey('short')).toBe('••••')
})
