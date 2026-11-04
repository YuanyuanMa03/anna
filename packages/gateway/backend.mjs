/** Explicit New API adapter. Credentials belong to the signed-in user, never a shared admin fallback. */
export class BackendError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

export async function backend(config, identity, path, body, method) {
  const response = await fetch(`${config.backendURL}${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      ...(identity ? { 'authorization': `Bearer ${identity.accessToken}`, 'New-Api-User': String(identity.id) } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  })
  const text = await response.text()
  let result
  try { result = JSON.parse(text) }
  catch { throw new BackendError(502, '后端协议不匹配，请检查网关版本与地址。') }
  if (!response.ok || result.success === false) {
    // Never reflect provider error strings, API keys or backend internals to the browser.
    throw new BackendError([401, 403, 429].includes(response.status) ? response.status : 400, '后端拒绝操作。请检查登录、权限、额度或填写内容。')
  }
  return result.data ?? result
}

export async function login(config, username, password) {
  const value = await backend(config, undefined, '/api/user/login', { username, password })
  if (!value.access_token || !Number.isInteger(value.user?.id))
    throw new BackendError(401, '此账号需额外登录验证，请先在后端完成；本次没有建立工作台会话。')
  return { accessToken: value.access_token, id: value.user.id, role: value.user.role, name: value.user.display_name || value.user.username }
}

export function page(value) {
  return { items: Array.isArray(value) ? value : value.items ?? [], total: Array.isArray(value) ? value.length : value.total ?? 0 }
}

export function capability(channel) {
  const saved = /^anna:(llm|asr|tts)$/.exec(channel.remark || '')?.[1]
  if (saved)
    return saved
  const models = (channel.models || '').split(',')
  if (models.includes('kokoro-local'))
    return 'tts'
  if (models.includes('paraformer-zh-en'))
    return 'asr'
  return 'llm'
}

export function localModel(channel) {
  try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(channel.base_url).hostname) }
  catch { return false }
}

export const serviceView = channel => ({ id: channel.id, name: channel.name, type: channel.type, status: channel.status, baseURL: channel.base_url || '', models: channel.models || '', kind: capability(channel), local: localModel(channel), testedAt: channel.test_time || null, responseMs: channel.response_time || null })
export const deviceView = token => ({ id: token.id, name: token.name, status: token.status, remaining: token.remain_quota, used: token.used_quota, unlimited: token.unlimited_quota, expires: token.expired_time, models: token.model_limits_enabled ? token.model_limits : '', accessedAt: token.accessed_time })
export const usageView = log => ({ id: log.id, at: log.created_at, type: log.type, device: log.token_name, model: log.model_name, points: log.quota, input: log.prompt_tokens, output: log.completion_tokens, seconds: log.use_time, requestId: log.request_id || '' })
