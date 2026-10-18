/**
 * What's left on a provider account, ported from cc-switch (`services/balance.rs`, `services/coding_plan.rs`):
 * account balances (DeepSeek, StepFun, SiliconFlow, OpenRouter, Novita) and Coding Plan quota windows (Kimi, Zhipu
 * GLM, MiniMax). Providers are recognised by their address; the key goes only to that provider's own API.
 */
export interface Balance { label: string, remaining: number, total?: number, used?: number, unit: string }
/** A quota window: how much of it is used, and when it resets. */
export interface QuotaWindow { window: 'five_hour' | 'weekly', usedPercent: number, resetsAt?: string }
export interface ProviderUsage { kind: 'balance' | 'quota', balances?: Balance[], windows?: QuotaWindow[], plan?: string, keyRejected?: boolean, error?: string }

type Kind = 'deepseek' | 'stepfun' | 'siliconflow-cn' | 'siliconflow-en' | 'openrouter' | 'novita' | 'kimi' | 'zhipu-cn' | 'zhipu-en' | 'minimax-cn' | 'minimax-en'

function hostOf(url: string) {
  try { return new URL(url).hostname.toLowerCase() }
  catch { return '' }
}
const on = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

function detect(baseUrl: string): Kind | undefined {
  const host = hostOf(baseUrl)
  const lower = baseUrl.toLowerCase()
  if (host === 'api.deepseek.com')
    return 'deepseek'
  if (host === 'api.stepfun.com' || host === 'api.stepfun.ai')
    return 'stepfun'
  if (host === 'api.siliconflow.cn')
    return 'siliconflow-cn'
  if (host === 'api.siliconflow.com')
    return 'siliconflow-en'
  if (on(host, 'openrouter.ai'))
    return 'openrouter'
  if (host === 'api.novita.ai')
    return 'novita'
  if (host === 'api.kimi.com' && lower.includes('/coding'))
    return 'kimi'
  if (on(host, 'bigmodel.cn'))
    return 'zhipu-cn'
  if (host === 'api.z.ai')
    return 'zhipu-en'
  if (host === 'api.minimaxi.com' || host === 'api.minimax.cn')
    return 'minimax-cn'
  if (host === 'api.minimax.io')
    return 'minimax-en'
}

/** Whether Anna can look up this provider's balance or quota. */
export function usageKind(baseUrl?: string): ProviderUsage['kind'] | undefined {
  const kind = baseUrl ? detect(baseUrl) : undefined
  return !kind ? undefined : ['kimi', 'zhipu-cn', 'zhipu-en', 'minimax-cn', 'minimax-en'].includes(kind) ? 'quota' : 'balance'
}

function number(value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}
/** Seconds or milliseconds since the epoch, or an ISO string, as ISO. */
function resetTime(value: unknown): string | undefined {
  if (typeof value === 'string' && value)
    return Number.isNaN(Number(value)) ? value : resetTime(Number(value))
  if (typeof value === 'number' && value > 0)
    return new Date(value < 1e12 ? value * 1000 : value).toISOString()
}

export function parseDeepSeek(body: any): Pick<ProviderUsage, 'balances'> {
  const balances: Balance[] = (body?.balance_infos ?? []).map((info: any) => ({ label: info.currency ?? 'CNY', remaining: number(info.total_balance) ?? 0, unit: info.currency ?? 'CNY' }))
  // Several wallets: an empty one is noise next to one with funds.
  return { balances: balances.some(item => item.remaining > 0) ? balances.filter(item => item.remaining > 0) : balances }
}
export function parseOpenRouter(body: any): Pick<ProviderUsage, 'balances'> {
  const data = body?.data ?? body
  const total = number(data?.total_credits)
  const used = number(data?.total_usage)
  if (total === undefined || used === undefined)
    throw new Error('OpenRouter 返回的额度不完整')
  return { balances: [{ label: 'OpenRouter', remaining: total - used, total, used, unit: 'USD' }] }
}
export function parseKimi(body: any): Pick<ProviderUsage, 'windows'> {
  const window = (detail: any, name: QuotaWindow['window']): QuotaWindow => {
    const limit = number(detail?.limit) ?? 1
    const remaining = number(detail?.remaining) ?? 0
    return { window: name, usedPercent: limit > 0 ? Math.max(limit - remaining, 0) / limit * 100 : 0, resetsAt: resetTime(detail?.resetTime) }
  }
  return { windows: [...(body?.limits ?? []).filter((item: any) => item?.detail).map((item: any) => window(item.detail, 'five_hour')), ...(body?.usage ? [window(body.usage, 'weekly')] : [])] }
}
export function parseZhipu(body: any): Pick<ProviderUsage, 'windows' | 'plan'> {
  if (body?.success === false)
    throw new Error(body.msg ?? '智谱返回了错误')
  const limits = (body?.data?.limits ?? []).filter((item: any) => /^(?:TOKENS|CREDIT)_LIMIT$/i.test(item?.type ?? ''))
  // unit 3 is the 5-hour window, 6 the weekly one; unlabelled ones fill the gaps, earliest reset first.
  const slots: Partial<Record<QuotaWindow['window'], QuotaWindow>> = {}
  const loose: { reset?: number, window: Omit<QuotaWindow, 'window'> }[] = []
  for (const item of limits) {
    const entry = { usedPercent: number(item.percentage) ?? 0, resetsAt: resetTime(item.nextResetTime) }
    const name = item.unit === 3 ? 'five_hour' : item.unit === 6 ? 'weekly' : undefined
    if (name && !slots[name])
      slots[name] = { window: name, ...entry }
    else loose.push({ reset: number(item.nextResetTime), window: entry })
  }
  loose.sort((a, b) => (a.reset ?? -Infinity) - (b.reset ?? -Infinity))
  for (const { window } of loose) {
    const name = !slots.five_hour ? 'five_hour' : !slots.weekly ? 'weekly' : undefined
    if (name)
      slots[name] = { window: name, ...window }
  }
  return { windows: [slots.five_hour, slots.weekly].filter((item): item is QuotaWindow => Boolean(item)), plan: body?.data?.level }
}
export function parseMiniMax(body: any): Pick<ProviderUsage, 'windows'> {
  if (body?.base_resp && body.base_resp.status_code !== 0)
    throw new Error(body.base_resp.status_msg ?? 'MiniMax 返回了错误')
  const item = (body?.model_remains ?? []).find((entry: any) => entry?.model_name === 'general')
  const windows: QuotaWindow[] = []
  if (number(item?.current_interval_remaining_percent) !== undefined)
    windows.push({ window: 'five_hour', usedPercent: 100 - number(item.current_interval_remaining_percent)!, resetsAt: resetTime(item.end_time) })
  if (item?.current_weekly_status === 1 && number(item?.current_weekly_remaining_percent) !== undefined)
    windows.push({ window: 'weekly', usedPercent: 100 - number(item.current_weekly_remaining_percent)!, resetsAt: resetTime(item.weekly_end_time) })
  return { windows }
}

interface Query { url: string, auth: 'bearer' | 'raw', parse: (body: any) => Omit<ProviderUsage, 'kind'> }
const queries: Record<Kind, Query> = {
  'deepseek': { url: 'https://api.deepseek.com/user/balance', auth: 'bearer', parse: parseDeepSeek },
  'stepfun': { url: 'https://api.stepfun.com/v1/accounts', auth: 'bearer', parse: body => ({ balances: [{ label: 'StepFun', remaining: number(body?.balance) ?? 0, unit: 'CNY' }] }) },
  'siliconflow-cn': { url: 'https://api.siliconflow.cn/v1/user/info', auth: 'bearer', parse: body => ({ balances: [{ label: 'SiliconFlow', remaining: number(body?.data?.totalBalance) ?? 0, unit: 'CNY' }] }) },
  'siliconflow-en': { url: 'https://api.siliconflow.com/v1/user/info', auth: 'bearer', parse: body => ({ balances: [{ label: 'SiliconFlow', remaining: number(body?.data?.totalBalance) ?? 0, unit: 'USD' }] }) },
  'openrouter': { url: 'https://openrouter.ai/api/v1/credits', auth: 'bearer', parse: parseOpenRouter },
  'novita': { url: 'https://api.novita.ai/v3/user/balance', auth: 'bearer', parse: (body) => {
    const available = number(body?.availableBalance)
    if (available === undefined)
      throw new Error('Novita 返回的余额不完整')
    return { balances: [{ label: 'Novita AI', remaining: available / 10000, unit: 'USD' }] }
  } },
  'kimi': { url: 'https://api.kimi.com/coding/v1/usages', auth: 'bearer', parse: parseKimi },
  // Zhipu's monitor API takes the bare key, without "Bearer".
  'zhipu-cn': { url: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit', auth: 'raw', parse: parseZhipu },
  'zhipu-en': { url: 'https://api.z.ai/api/monitor/usage/quota/limit', auth: 'raw', parse: parseZhipu },
  'minimax-cn': { url: 'https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains', auth: 'bearer', parse: parseMiniMax },
  'minimax-en': { url: 'https://api.minimax.io/v1/api/openplatform/coding_plan/remains', auth: 'bearer', parse: parseMiniMax },
}

/** Look up the balance or quota behind this key. A refused key is reported as such, never thrown. */
export async function queryUsage(baseUrl: string, key: string, options: { fetch?: typeof fetch } = {}): Promise<ProviderUsage> {
  const kind = detect(baseUrl)
  if (!kind)
    throw new Error('还不支持查询这个服务商的余额')
  const result = { kind: usageKind(baseUrl)! }
  if (!key.trim())
    return { ...result, error: '还没有存密钥' }
  const query = queries[kind]
  let response: Response
  try { response = await (options.fetch ?? fetch)(query.url, { headers: { Authorization: query.auth === 'raw' ? key : `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }) }
  catch (error) { return { ...result, error: (error as Error).name === 'TimeoutError' ? '查询超时' : '连不上服务商' } }
  if (response.status === 401 || response.status === 403)
    return { ...result, keyRejected: true, error: '服务商拒绝了这个密钥' }
  if (!response.ok)
    return { ...result, error: `服务商返回 HTTP ${response.status}` }
  try { return { ...result, ...query.parse(await response.json()) } }
  catch (error) { return { ...result, error: error instanceof SyntaxError ? '服务商返回的不是 JSON' : (error as Error).message } }
}
