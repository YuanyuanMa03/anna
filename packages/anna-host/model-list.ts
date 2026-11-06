import type { ModelSettings } from '../shared/contracts'
import { Buffer } from 'node:buffer'

export { sameEndpoint } from '../shared/model-vendors'

type Fetcher = (url: string, init: RequestInit) => Promise<Response>

const maxBytes = 2 * 1024 * 1024
const modelId = /^[\w./:@+-]{1,200}$/
const base = (url: string) => url.replace(/\/+$/, '')

/**
 * The models a vendor offers this key: `GET /models` on OpenAI-compatible endpoints, `GET /v1/models` on Anthropic's.
 * Runs in the host so a saved key never reaches the renderer. Redirects are refused, so the key goes nowhere else.
 */
export async function listModels(model: Pick<ModelSettings, 'baseURL' | 'api'>, key: string, fetcher: Fetcher = fetch, timeoutMs = 15_000): Promise<string[]> {
  if (!key)
    throw new Error('请先填写 API Key')
  const root = new URL(model.baseURL)
  if (root.protocol !== 'https:' || root.username || root.password || root.search || root.hash)
    throw new Error('API 端点必须是无凭据和查询参数的 HTTPS 地址')
  const anthropic = model.api === 'anthropic-messages'
  const url = anthropic ? `${/\/v1$/.test(base(model.baseURL)) ? base(model.baseURL) : `${base(model.baseURL)}/v1`}/models?limit=1000` : `${base(model.baseURL)}/models`
  const headers: Record<string, string> = anthropic ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${key}` }
  let response: Response
  try {
    response = await fetcher(url, { headers: { ...headers, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
  }
  catch {
    throw new Error('连不上这个地址，请检查网络或 API 端点')
  }
  if (response.status === 401 || response.status === 403)
    throw new Error('API Key 无效，或者和这个服务地址不匹配')
  if (response.status === 404 || response.status === 405)
    throw new Error('这个服务不提供模型列表，请从推荐模型中选择或手动填写模型 ID')
  if (!response.ok)
    throw new Error(`获取模型列表失败（HTTP ${response.status}）`)
  const text = await bounded(response)
  let body: unknown
  try { body = JSON.parse(text) }
  catch { throw new Error('看不懂服务返回的模型列表') }
  const data = (body as { data?: unknown })?.data
  if (!Array.isArray(data))
    throw new Error('看不懂服务返回的模型列表')
  const ids = data.map(item => (item as { id?: unknown })?.id).filter((id): id is string => typeof id === 'string' && modelId.test(id))
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).slice(0, 1000)
}

async function bounded(response: Response) {
  const reader = response.body?.getReader()
  if (!reader)
    return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done)
      break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error('服务返回的模型列表过大')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}
