import { describe, expect, it } from 'vitest'
import { parseDeepSeek, parseKimi, parseMiniMax, parseOpenRouter, parseZhipu, queryUsage, usageKind } from '../packages/agents/usage'

describe('balances and Coding Plan quotas (ported from cc-switch)', () => {
  it('recognises providers by address, including the Anthropic and Responses paths of the same service', () => {
    expect(usageKind('https://api.deepseek.com/anthropic')).toBe('balance')
    expect(usageKind('https://openrouter.ai/api/v1')).toBe('balance')
    expect(usageKind('https://api.kimi.com/coding/v1')).toBe('quota')
    expect(usageKind('https://open.bigmodel.cn/api/anthropic')).toBe('quota')
    expect(usageKind('https://api.minimax.io/v1')).toBe('quota')
    expect(usageKind('https://api.moonshot.cn/v1')).toBeUndefined()
    expect(usageKind('https://api.minimax.io.example.com/v1')).toBeUndefined()
  })

  it('parses each provider\'s answer', () => {
    // DeepSeek: an empty wallet is hidden next to one with funds.
    expect(parseDeepSeek({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '12.30' }, { currency: 'USD', total_balance: '0.00' }] }).balances).toEqual([{ label: 'CNY', remaining: 12.3, unit: 'CNY' }])
    expect(parseOpenRouter({ data: { total_credits: 10, total_usage: '2.5' } }).balances).toEqual([{ label: 'OpenRouter', remaining: 7.5, total: 10, used: 2.5, unit: 'USD' }])
    expect(() => parseOpenRouter({ data: {} })).toThrow()
    expect(parseKimi({ limits: [{ detail: { limit: 100, remaining: 25, resetTime: 1792400000 } }], usage: { limit: '1000', remaining: '900' } }).windows).toEqual([
      { window: 'five_hour', usedPercent: 75, resetsAt: new Date(1792400000 * 1000).toISOString() },
      { window: 'weekly', usedPercent: 10, resetsAt: undefined },
    ])
    // Zhipu: unit 3 = 5 hours, 6 = weekly; unlabelled windows fill the gaps by earliest reset; MCP limits are ignored.
    expect(parseZhipu({ success: true, data: { level: 'pro', limits: [{ type: 'TIME_LIMIT', percentage: 99 }, { type: 'TOKENS_LIMIT', unit: 6, percentage: 40, nextResetTime: 1792500000000 }, { type: 'TOKENS_LIMIT', percentage: 12, nextResetTime: 1792400000000 }] } })).toEqual({
      plan: 'pro',
      windows: [{ window: 'five_hour', usedPercent: 12, resetsAt: new Date(1792400000000).toISOString() }, { window: 'weekly', usedPercent: 40, resetsAt: new Date(1792500000000).toISOString() }],
    })
    expect(() => parseZhipu({ success: false, msg: 'token expired' })).toThrow('token expired')
    expect(parseMiniMax({ base_resp: { status_code: 0 }, model_remains: [{ model_name: 'general', current_interval_remaining_percent: 94, end_time: 1792400000000, current_weekly_status: 1, current_weekly_remaining_percent: 80 }] }).windows).toEqual([
      { window: 'five_hour', usedPercent: 6, resetsAt: new Date(1792400000000).toISOString() },
      { window: 'weekly', usedPercent: 20, resetsAt: undefined },
    ])
  })

  it('queries the provider\'s own API with the key in the form it expects; refused keys and timeouts are answers, not throws', async () => {
    const calls: { url: string, auth?: string }[] = []
    const answer = (status: number, body: unknown) => (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: (init?.headers as Record<string, string>).Authorization })
      return new Response(JSON.stringify(body), { status })
    }) as typeof fetch
    expect(await queryUsage('https://api.deepseek.com', 'sk-1', { fetch: answer(200, { balance_infos: [{ currency: 'CNY', total_balance: '3' }] }) })).toEqual({ kind: 'balance', balances: [{ label: 'CNY', remaining: 3, unit: 'CNY' }] })
    await queryUsage('https://open.bigmodel.cn/api/anthropic', 'zp-key', { fetch: answer(200, { success: true, data: { limits: [] } }) })
    expect(calls).toEqual([{ url: 'https://api.deepseek.com/user/balance', auth: 'Bearer sk-1' }, { url: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit', auth: 'zp-key' }])
    expect(await queryUsage('https://api.kimi.com/coding/v1', 'k', { fetch: answer(401, {}) })).toEqual({ kind: 'quota', keyRejected: true, error: '服务商拒绝了这个密钥' })
    expect(await queryUsage('https://openrouter.ai/api/v1', '', { fetch: answer(200, {}) })).toEqual({ kind: 'balance', error: '还没有存密钥' })
    const timeout = (async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }) }) as typeof fetch
    expect(await queryUsage('https://openrouter.ai/api/v1', 'k', { fetch: timeout })).toEqual({ kind: 'balance', error: '查询超时' })
    await expect(queryUsage('https://api.moonshot.cn/v1', 'k')).rejects.toThrow('还不支持')
  })
})
