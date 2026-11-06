import type { ModelSettings } from '../shared/contracts'
import { Buffer } from 'node:buffer'

export { sameEndpoint } from '../shared/model-vendors'

type Fetcher = (url: string, init: RequestInit) => Promise<Response>

const maxBytes = 2 * 1024 * 1024
const modelId = /^[\w./:@+-]{1,200}$/
/** Models a vendor lists that cannot hold a conversation: embeddings, speech, images, moderation, reranking. */
const notChat = /embed|whisper|tts|transcri|speech|dall-e|image|moderation|rerank|audio|-asr\b|realtime/i
const base = (url: string) => url.replace(/\/+$/, '')
const unreachable = '连不上这个地址，请检查网络或 API 端点'
const noList = '请从推荐模型中选择，或手动填写模型 ID'

class ListError extends Error {}

/**
 * The chat models a vendor offers this key: `GET /models` on OpenAI-compatible endpoints, `GET /v1/models` on
 * Anthropic's (one page of up to 1000, its documented maximum). Runs in the host so a saved key never reaches the
 * renderer. Redirects are refused, so the key goes nowhere else.
 */
export async function listModels(model: Pick<ModelSettings, 'baseURL' | 'api'>, key: string, fetcher: Fetcher = fetch, options: { timeoutMs?: number, signal?: AbortSignal } = {}): Promise<string[]> {
  if (!key)
    throw new Error('请先填写 API Key')
  let root: URL
  try { root = new URL(model.baseURL) }
  catch { throw new Error('API 端点必须是无凭据和查询参数的 HTTPS 地址') }
  if (root.protocol !== 'https:' || root.username || root.password || root.search || root.hash)
    throw new Error('API 端点必须是无凭据和查询参数的 HTTPS 地址')
  const anthropic = model.api === 'anthropic-messages'
  const url = anthropic ? `${/\/v1$/.test(base(model.baseURL)) ? base(model.baseURL) : `${base(model.baseURL)}/v1`}/models?limit=1000` : `${base(model.baseURL)}/models`
  const headers: Record<string, string> = anthropic ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${key}` }
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 15_000), ...(options.signal ? [options.signal] : [])])
  try {
    const response = await fetcher(url, { headers: { ...headers, accept: 'application/json' }, redirect: 'error', signal })
    if (response.status === 401 || response.status === 403)
      throw new ListError('API Key 无效，或者和这个服务地址不匹配')
    if (response.status === 404 || response.status === 405)
      throw new ListError(`这个服务不提供模型列表，${noList}`)
    if (!response.ok)
      throw new ListError(`没能取到模型列表（HTTP ${response.status}），${noList}`)
    const text = await bounded(response, signal)
    let body: unknown
    try { body = JSON.parse(text) }
    catch { throw new ListError(`看不懂服务返回的模型列表，${noList}`) }
    const data = (body as { data?: unknown })?.data
    if (!Array.isArray(data))
      throw new ListError(`看不懂服务返回的模型列表，${noList}`)
    // Gemini's OpenAI-compatible list names models `models/<id>`; its chat endpoint takes the bare ID.
    const ids = data.map(item => (item as { id?: unknown })?.id).filter((id): id is string => typeof id === 'string').map(id => id.replace(/^models\//, '')).filter(id => modelId.test(id) && !notChat.test(id))
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).slice(0, 1000)
  }
  catch (error) {
    if (error instanceof ListError)
      throw error
    throw new Error(unreachable)
  }
}

async function bounded(response: Response, signal: AbortSignal) {
  if (!response.body)
    return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  // The timeout also bounds a body that stops arriving halfway.
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted)
      reject(signal.reason)
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  aborted.catch(() => {})
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted])
      if (done)
        break
      size += value.byteLength
      if (size > maxBytes)
        throw new ListError('服务返回的模型列表过大')
      chunks.push(value)
    }
  }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return new TextDecoder().decode(Buffer.concat(chunks))
}
