import { Buffer } from 'node:buffer'

/**
 * Provider deep links in cc-switch's format (`ccswitch://v1/import?resource=provider&…`, see its deeplink guide),
 * also accepted as `anna://v1/import?…`. Sites that already offer "Import to CC Switch" (New API, Sub2API) work as is.
 * Only providers for Claude Code, Codex and Gemini CLI in their native format, plus Chat Completions providers for
 * Codex (through Anna's local routing); everything else is refused with the reason. Nothing here applies anything: the result is shown to the user, who confirms.
 */
export interface LinkImport {
  app: 'claude' | 'codex' | 'gemini'
  name: string
  baseUrl: string
  /** Further addresses for the speed test. */
  endpoints: string[]
  key: string
  model?: string
  tiers?: { haiku?: string, sonnet?: string, opus?: string }
  /** Extra Claude Code env vars from an embedded config. */
  env?: Record<string, string>
  website?: string
  /** The link's suggestion for "use it after import"; the user decides. */
  enabled: boolean
  /** Things the confirmation card should point out. */
  warnings: string[]
  /** codex: a Chat Completions provider, which Codex reaches through Anna's local routing. */
  apiFormat?: 'openai_chat'
}

const native = { claude: 'anthropic', codex: 'openai_responses', gemini: 'gemini_native' } as const
/** Env vars that change how processes load code: never taken from a link. */
export const loaderEnv = /^(?:NODE_OPTIONS|NODE_PATH|LD_\w+|DYLD_\w+|\w*_PRELOAD|PYTHONPATH|PYTHONSTARTUP|PERL5OPT|RUBYOPT|BASH_ENV|ENV|PATH|SHELL|HOME|ELECTRON_\w+)$/i

function base64(value: string) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/').replace(/ /g, '+'), 'base64').toString('utf8')
}

function privateHost(url: string) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' || host.endsWith('.local') || /^(?:127|10)\./.test(host) || /^192\.168\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)
}

/** Parse and check a link; throws with a reason the user can read. */
export function parseProviderLink(link: string): LinkImport {
  let url: URL
  try { url = new URL(link.trim()) }
  catch { throw new Error('这不是一个有效的导入链接') }
  if (url.protocol !== 'ccswitch:' && url.protocol !== 'anna:')
    throw new Error('只认 anna:// 或 ccswitch:// 开头的导入链接')
  // ccswitch://v1/import → host "v1", path "/import".
  if (`${url.host}${url.pathname}` !== 'v1/import')
    throw new Error('链接的版本或路径不对（应为 v1/import）')
  const query = url.searchParams
  const resource = query.get('resource')
  if (resource !== 'provider')
    throw new Error(resource && ['mcp', 'prompt', 'skill'].includes(resource) ? `${resource} 链接的导入还没做（下一阶段）` : '链接没有说明要导入什么')
  if (query.has('configUrl'))
    throw new Error('不支持从远程地址加载配置的链接')
  const app = query.get('app')
  if (app !== 'claude' && app !== 'codex' && app !== 'gemini')
    throw new Error(`还不能导入给 ${app ?? '未知应用'} 的服务商（支持 Claude Code、Codex、Gemini CLI）`)
  const format = query.get('apiFormat') ?? native[app]
  // Codex reaches a Chat Completions provider through Anna's local routing; other conversions come later.
  const routed = app === 'codex' && format === 'openai_chat'
  if (format !== native[app] && !routed)
    throw new Error(`这个服务商用 ${format} 格式，${app} 要通过本地路由转换才能用（下一阶段）`)

  // An embedded config fills what the URL parameters leave out; the parameters win.
  let config: Record<string, any> = {}
  const raw = query.get('config')
  if (raw) {
    const text = base64(raw)
    if ((query.get('configFormat') ?? 'json') === 'toml') {
      const field = (key: string) => new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(text)?.[1]
      config = { env: {}, baseUrl: field('base_url'), model: field('model') }
    }
    else {
      try { config = JSON.parse(text) }
      catch { throw new Error('链接里的配置不是有效的 JSON') }
    }
  }
  const env: Record<string, string> = Object.fromEntries(Object.entries(config.env ?? {}).filter(([, value]) => typeof value === 'string')) as Record<string, string>
  const loaders = Object.keys(env).filter(key => loaderEnv.test(key))
  if (loaders.length)
    throw new Error(`链接想设置会改变程序加载方式的环境变量（${loaders.join('、')}），已拒绝`)
  const fromEnv = app === 'claude' ? { url: env.ANTHROPIC_BASE_URL, key: env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL } : app === 'gemini' ? { url: env.GOOGLE_GEMINI_BASE_URL, key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL } : { url: config.baseUrl as string | undefined, key: undefined, model: config.model as string | undefined }
  const endpoints = (query.get('endpoint') ?? fromEnv.url ?? '').split(',').map(item => item.trim()).filter(Boolean)
  const name = query.get('name')?.trim()
  const key = (query.get('apiKey') ?? fromEnv.key ?? '').trim()
  if (!name)
    throw new Error('链接缺少服务商名称')
  if (!endpoints.length)
    throw new Error('链接缺少请求地址')
  if (!key)
    throw new Error('链接里没有 API Key，导入不了（这类按钮应该在登录后的控制台里）')
  for (const endpoint of endpoints) {
    if (!URL.canParse(endpoint) || !/^https?:$/.test(new URL(endpoint).protocol))
      throw new Error(`请求地址无效：${endpoint}`)
  }
  const warnings: string[] = []
  if (endpoints.some(privateHost))
    warnings.push('请求地址指向本机或局域网')
  const extra = app === 'claude' ? Object.fromEntries(Object.entries(env).filter(([name]) => !/^ANTHROPIC_(?:BASE_URL|AUTH_TOKEN|API_KEY|MODEL|DEFAULT_(?:HAIKU|SONNET|OPUS)_MODEL)$/.test(name))) : {}
  if (Object.keys(extra).length)
    warnings.push(`还会设置环境变量：${Object.keys(extra).join('、')}`)
  const tiers = app === 'claude' ? { haiku: query.get('haikuModel') ?? env.ANTHROPIC_DEFAULT_HAIKU_MODEL, sonnet: query.get('sonnetModel') ?? env.ANTHROPIC_DEFAULT_SONNET_MODEL, opus: query.get('opusModel') ?? env.ANTHROPIC_DEFAULT_OPUS_MODEL } : undefined
  return {
    app,
    name: name.slice(0, 60),
    baseUrl: endpoints[0]!.replace(/\/+$/, ''),
    endpoints: endpoints.slice(1),
    key,
    model: query.get('model') ?? fromEnv.model ?? undefined,
    tiers: tiers && Object.values(tiers).some(Boolean) ? tiers : undefined,
    env: Object.keys(extra).length ? extra : undefined,
    website: query.get('homepage') ?? undefined,
    enabled: query.get('enabled') === 'true',
    warnings,
    ...(routed ? { apiFormat: 'openai_chat' as const } : {}),
  }
}

/** The key as the confirmation card shows it. */
export const maskKey = (key: string) => key.length <= 8 ? '••••' : `${key.slice(0, 4)}••••${key.slice(-4)}`
