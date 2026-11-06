import { describe, expect, it, vi } from 'vitest'
import { listModels, sameEndpoint } from '../packages/anna-host/model-list'
import { validateModel } from '../packages/anna-host/settings'
import { modelVendors, vendorFor, vendorSettings } from '../packages/shared/model-vendors'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('model vendors', () => {
  it('lists each vendor once, every one a valid pi model setting', () => {
    expect(new Set(modelVendors.map(vendor => vendor.id)).size).toBe(modelVendors.length)
    for (const vendor of modelVendors) {
      const settings = vendorSettings(vendor, vendor.models[0] ?? 'some-model')
      expect(() => validateModel(settings), vendor.id).not.toThrow()
      expect(vendor.keyPage, vendor.id).toMatch(/^https:\/\//)
    }
  })

  it('keeps DeepSeek on pi\'s own catalogue and the rest on a custom endpoint', () => {
    expect(vendorSettings(vendorFor({ provider: 'deepseek-official', baseURL: 'https://api.deepseek.com', api: 'openai-completions' })!, 'deepseek-flash').provider).toBe('deepseek-official')
    expect(modelVendors.filter(vendor => vendor.id !== 'deepseek').every(vendor => vendorSettings(vendor, 'x').provider === 'custom')).toBe(true)
  })

  it('recognises a saved setting by its endpoint and protocol, ignoring a trailing slash', () => {
    expect(vendorFor({ provider: 'custom', baseURL: 'https://api.moonshot.cn/v1/', api: 'openai-completions' })?.id).toBe('kimi')
    expect(vendorFor({ provider: 'custom', baseURL: 'https://api.anthropic.com', api: 'anthropic-messages' })?.id).toBe('anthropic')
    expect(vendorFor({ provider: 'custom', baseURL: 'https://example.com/v1', api: 'openai-completions' })).toBeUndefined()
  })
})

describe('model list', () => {
  it('asks an OpenAI-compatible endpoint for /models with a bearer key and never follows redirects', async () => {
    const fetcher = vi.fn(async () => json({ data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'b-model' }, { id: 'bad id with spaces' }, { name: 'no id' }] }))
    const models = await listModels({ baseURL: 'https://api.moonshot.cn/v1/', api: 'openai-completions' }, 'sk-test', fetcher)
    expect(models).toEqual(['a-model', 'b-model'])
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.moonshot.cn/v1/models')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
    expect(init.redirect).toBe('error')
  })

  it('asks Anthropic for /v1/models with its own headers', async () => {
    const fetcher = vi.fn(async () => json({ data: [{ id: 'claude-x' }] }))
    expect(await listModels({ baseURL: 'https://api.anthropic.com', api: 'anthropic-messages' }, 'sk-ant', fetcher)).toEqual(['claude-x'])
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1000')
    expect(init.headers).toMatchObject({ 'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01' })
    expect((init.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('does not double /v1 for an Anthropic-compatible endpoint that already ends with it', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => json({ data: [] }))
    await listModels({ baseURL: 'https://example.com/anthropic/v1', api: 'anthropic-messages' }, 'k', fetcher)
    expect(fetcher.mock.calls[0]![0]).toBe('https://example.com/anthropic/v1/models?limit=1000')
  })

  it('says what to change when the service refuses', async () => {
    await expect(listModels({ baseURL: 'https://a.example/v1', api: 'openai-completions' }, 'k', async () => json({}, 401))).rejects.toThrow(/API Key 无效/)
    await expect(listModels({ baseURL: 'https://a.example/v1', api: 'openai-completions' }, 'k', async () => json({}, 404))).rejects.toThrow(/不提供模型列表/)
    await expect(listModels({ baseURL: 'https://a.example/v1', api: 'openai-completions' }, 'k', async () => json({ data: 'nope' }))).rejects.toThrow(/看不懂/)
    await expect(listModels({ baseURL: 'https://a.example/v1', api: 'openai-completions' }, 'k', async () => { throw new TypeError('fetch failed') })).rejects.toThrow(/连不上/)
  })

  it('refuses a reply too large to be a model list', async () => {
    const huge = new Response('x'.repeat(3 * 1024 * 1024), { status: 200 })
    await expect(listModels({ baseURL: 'https://a.example/v1', api: 'openai-completions' }, 'k', async () => huge)).rejects.toThrow(/过大/)
  })

  it('needs a key and an HTTPS endpoint', async () => {
    await expect(listModels({ baseURL: 'https://a.example/v1', api: 'openai-completions' }, '', async () => json({ data: [] }))).rejects.toThrow(/API Key/)
    await expect(listModels({ baseURL: 'http://a.example/v1', api: 'openai-completions' }, 'k', async () => json({ data: [] }))).rejects.toThrow(/HTTPS/)
  })
})

describe('saved key reuse', () => {
  it('lets a saved key follow only the same service address', () => {
    expect(sameEndpoint('https://api.moonshot.cn/v1', 'https://api.moonshot.cn/v1/')).toBe(true)
    expect(sameEndpoint('https://api.moonshot.cn/v1', 'https://api.moonshot.cn/anthropic')).toBe(false)
    expect(sameEndpoint('https://api.moonshot.cn/v1', 'https://evil.example/v1')).toBe(false)
    expect(sameEndpoint('https://API.Moonshot.cn/v1', 'https://api.moonshot.cn/v1')).toBe(true)
  })
})
