import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { backend, BackendError, capability, deviceView, localModel, login, page, serviceView, usageView } from './backend.mjs'
import { privateHost } from './config.mjs'
import { json } from './server.mjs'

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/workbench.css', ['workbench.css', 'text/css; charset=utf-8']],
  ['/workbench.js', ['workbench.js', 'text/javascript; charset=utf-8']],
  ['/anna.svg', ['anna.svg', 'image/svg+xml']],
])
const assetRoot = new URL('../gateway-ui/', import.meta.url)
const age = 8 * 60 * 60 * 1000
const cookieName = 'anna_workbench_session'
const cookieToken = request => request.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)

async function bytes(request, limit = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > limit) {
      request.resume()
      throw new BackendError(413, '请求文件过大。')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function number(value, max = 1_000_000_000) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    throw new BackendError(400, '请输入有效的非负整数。')
  return value
}
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 40)
    throw new BackendError(400, '名称须为 1–40 个字符。')
  return value.trim()
}

export function workbenchServer({ getConfig, getDataAddress, applyConfig }) {
  const sessions = new Map()
  const codes = new Map()
  let owner
  function codeFor(identity) {
    for (const [key, value] of codes) {
      if (value.expires < Date.now())
        codes.delete(key)
    }
    if (codes.size >= 10)
      throw new BackendError(429, '打开链接过多，请稍后重试。')
    const code = randomBytes(32).toString('hex')
    codes.set(code, { identity, expires: Date.now() + 60_000 })
    return code
  }
  let attempts = []
  let active = 0
  const server = createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    response.setHeader('cache-control', 'no-store')
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('referrer-policy', 'no-referrer')
    response.setHeader('content-security-policy', 'default-src \'self\'; script-src \'self\'; style-src \'self\'; img-src \'self\'; connect-src \'self\'; media-src blob:; frame-ancestors \'self\' file: http://127.0.0.1:5193; base-uri \'none\'; form-action \'self\'')
    const port = server.address()?.port
    const origin = `http://127.0.0.1:${port}`
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host)) {
      json(response, 403, { error: '请使用工作台本机地址访问。' })
      return
    }
    if (request.headers.origin && request.headers.origin !== origin && request.headers.origin !== `http://localhost:${port}`) {
      json(response, 403, { error: '请求来源不允许。' })
      return
    }
    if (active >= 8) {
      json(response, 503, { error: '工作台正忙，请稍后再试。' })
      return
    }
    active++
    void handle(request, response).catch((error) => {
      if (!response.headersSent) {
        response.setHeader('connection', 'close')
        json(response, error instanceof BackendError ? error.status : 502, { error: error instanceof BackendError ? error.message : '操作未完成；请检查后端连接，填写内容已保留。' })
      }
      else { response.destroy() }
    }).finally(() => { active-- })
  })
  server.headersTimeout = 10_000
  server.requestTimeout = 120_000

  function session(identity, response) {
    for (const [key, value] of sessions) {
      if (value.expires < Date.now())
        sessions.delete(key)
    }
    if (sessions.size >= 64)
      throw new BackendError(429, '会话过多，请稍后重试。')
    const token = randomBytes(32).toString('hex')
    sessions.set(token, { ...identity, expires: Date.now() + age })
    response.setHeader('set-cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/manage`)
    return { token, user: { id: identity.id, name: identity.name, admin: identity.role >= 10 } }
  }

  async function channels(identity) {
    if (identity.role < 10)
      return []
    // Only used to resolve explicit mutations/test policies. The visible catalog itself is paginated.
    const result = []
    for (let p = 1; p <= 20; p++) {
      const value = page(await backend(getConfig(), identity, `/api/channel/?p=${p}&page_size=100`))
      result.push(...value.items)
      if (result.length >= value.total || !value.items.length)
        return result
    }
    throw new BackendError(400, '服务数量超出首版操作范围，请在原管理端处理。')
  }

  async function handle(request, response) {
    const url = new URL(request.url, 'http://localhost')
    const path = url.pathname
    if (assets.has(path) && request.method === 'GET') {
      const [file, contentType] = assets.get(path)
      response.setHeader('content-type', contentType)
      response.end(await readFile(fileURLToPath(new URL(file, assetRoot))))
      return
    }
    if (path === '/manage/login' && request.method === 'POST') {
      attempts = attempts.filter(at => at > Date.now() - 60_000)
      if (attempts.length >= 10)
        throw new BackendError(429, '尝试过于频繁，请一分钟后重试。')
      attempts.push(Date.now())
      const body = JSON.parse((await bytes(request)).toString())
      if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.password.length > 512)
        throw new BackendError(400, '请填写后端账号和密码。')
      json(response, 200, session(await login(getConfig(), body.username, body.password), response))
      return
    }
    if (path === '/manage/redeem' && request.method === 'POST') {
      const { code } = JSON.parse((await bytes(request)).toString())
      const value = codes.get(code)
      codes.delete(code)
      if (!value || value.expires < Date.now())
        throw new BackendError(401, '本机登录链接已使用或过期，请重新打开。')
      json(response, 200, session(value.identity, response))
      return
    }
    if (path === '/manage/session' && request.method === 'GET') {
      const token = cookieToken(request)
      const value = sessions.get(token)
      json(response, 200, value && value.expires > Date.now() ? { loggedIn: true, token } : { loggedIn: false })
      return
    }
    const token = request.headers.authorization?.replace(/^Bearer /, '') ?? cookieToken(request)
    const identity = sessions.get(token)
    if (!identity || identity.expires < Date.now()) {
      sessions.delete(token)
      response.setHeader('set-cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/manage; Max-Age=0`)
      throw new BackendError(401, '请先登录 Anna 服务工作台。')
    }
    if (path === '/manage/logout' && request.method === 'POST') {
      sessions.delete(token)
      response.setHeader('set-cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/manage; Max-Age=0`)
      if (owner?.identity.id === identity.id)
        owner = undefined
      for (const [key, value] of codes) {
        if (value.identity.id === identity.id)
          codes.delete(key)
      }
      json(response, 200, { ok: true })
      return
    }
    const config = getConfig()
    if (path === '/manage/snapshot' && request.method === 'GET') {
      const p = Math.max(1, Math.min(10000, Number(url.searchParams.get('page')) || 1))
      if (!Number.isInteger(p))
        throw new BackendError(400, '页码无效。')
      const [user, services, devices, usage] = await Promise.all([
        backend(config, identity, '/api/user/self'),
        identity.role >= 10 ? backend(config, identity, `/api/channel/?p=${p}&page_size=20`).then(page) : { items: [], total: 0 },
        backend(config, identity, `/api/token/?p=${p}&page_size=20`).then(page),
        backend(config, identity, `/api/log/self?p=${p}&page_size=20`).then(page),
      ])
      const addresses = Object.values(networkInterfaces()).flat().filter(item => item && !item.internal && item.family === 'IPv4').map(item => item.address)
      json(response, 200, {
        user: { name: identity.name, admin: identity.role >= 10, remaining: user.quota, used: user.used_quota, requests: user.request_count },
        services: { items: services.items.map(serviceView), total: services.total },
        devices: { items: devices.items.map(deviceView), total: devices.total },
        usage: { items: usage.items.map(usageView), total: usage.total },
        deployment: { ...config, backendURL: undefined, dataAddress: getDataAddress(), addresses },
        page: p,
        updatedAt: new Date().toISOString(),
      })
      return
    }
    const device = /^\/manage\/devices\/(\d+)\/(quota|revoke)$/.exec(path)
    if (device && request.method === 'POST') {
      const previous = await backend(config, identity, `/api/token/${device[1]}`)
      if (device[2] === 'revoke') {
        await backend(config, identity, '/api/token/?status_only=true', { id: previous.id, status: 2 }, 'PUT')
      }
      else {
        const body = JSON.parse((await bytes(request)).toString())
        const remain = number(body.remaining)
        // UpdateToken is a replacement API: preserve every connection/scope field, never send a partial quota patch.
        const preserved = Object.fromEntries(['id', 'name', 'status', 'expired_time', 'unlimited_quota', 'model_limits_enabled', 'model_limits', 'allow_ips', 'group', 'cross_group_retry', 'allow_user_quota_query', 'auto_groups'].filter(key => previous[key] !== undefined).map(key => [key, previous[key]]))
        await backend(config, identity, '/api/token/', { ...preserved, remain_quota: remain, unlimited_quota: false }, 'PUT')
      }
      json(response, 200, { ok: true })
      return
    }
    if (path === '/manage/devices' && request.method === 'POST') {
      const body = JSON.parse((await bytes(request)).toString())
      const suffix = ` · ${randomBytes(8).toString('hex')}`
      let prefix = label(body.name)
      while (Buffer.byteLength(prefix + suffix) > 50) prefix = [...prefix].slice(0, -1).join('')
      const name = prefix + suffix
      const models = Array.isArray(body.models) ? body.models.filter(item => typeof item === 'string' && /^[\w./:@+-]{1,128}$/.test(item)).slice(0, 30) : []
      if (!models.length)
        throw new BackendError(400, '请至少选择一个模型。')
      const days = number(body.days ?? 30, 3650)
      await backend(config, identity, '/api/token/', { name, expired_time: days ? Math.floor(Date.now() / 1000) + days * 86400 : -1, remain_quota: number(body.remaining), unlimited_quota: false, model_limits_enabled: true, model_limits: models.join(','), group: 'default', allow_user_quota_query: false })
      const found = page(await backend(config, identity, `/api/token/search?keyword=${encodeURIComponent(name)}&p=1&page_size=100`)).items.find(item => item.name === name)
      if (!found)
        throw new BackendError(502, '设备已创建，但密钥未返回；请刷新设备列表，撤销后重建。')
      const value = await backend(config, identity, `/api/token/${found.id}/key`, {})
      json(response, 200, { device: deviceView(found), key: value.key.startsWith('sk-') ? value.key : `sk-${value.key}` })
      return
    }
    if (path === '/manage/services' && request.method === 'POST') {
      if (identity.role < 10)
        throw new BackendError(403, '只有管理员可以接入服务。')
      const body = JSON.parse((await bytes(request)).toString())
      if (!['llm', 'asr', 'tts'].includes(body.kind))
        throw new BackendError(400, '服务类型无效。')
      let address
      try { address = new URL(body.baseURL) }
      catch { throw new BackendError(400, '服务地址无效。') }
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)
      if (address.username || address.password || address.hash || address.search || (!['https:', 'http:'].includes(address.protocol)) || (address.protocol === 'http:' && !privateHost(address.hostname)))
        throw new BackendError(400, '公共服务须使用 HTTPS；HTTP 仅限可信私网，地址中不得包含密钥。')
      if (local && body.kind === 'llm' && !config.allowLocalLLM)
        throw new BackendError(400, '当前节点不接入本机语言模型，可使用云端或其他算力节点。')
      const models = String(body.models || '').split(',').map(model => model.trim()).filter(Boolean)
      if (!models.length || models.length > 30 || models.some(model => !/^[\w./:@+-]{1,128}$/.test(model)))
        throw new BackendError(400, '请填写有效模型 ID，多个用英文逗号分隔。')
      if ((!privateHost(address.hostname) && !body.key) || typeof body.key !== 'string' || body.key.length > 8192)
        throw new BackendError(400, '请填写 API Key。')
      await backend(config, identity, '/api/channel/', { mode: 'single', channel: { type: 1, name: label(body.name), base_url: address.href.replace(/\/$/, ''), key: body.key || 'local-no-provider-key', models: models.join(','), group: 'default', status: 1, remark: `anna:${body.kind}`, auto_ban: 0 } })
      json(response, 200, { ok: true, message: '已接入，尚未进行推理验证；请到试用区发起一次短请求。' })
      return
    }
    const service = /^\/manage\/services\/(\d+)\/status$/.exec(path)
    if (service && request.method === 'POST') {
      if (identity.role < 10)
        throw new BackendError(403, '需要管理员权限。')
      const body = JSON.parse((await bytes(request)).toString())
      if (![1, 2].includes(body.status))
        throw new BackendError(400, '状态无效。')
      const found = (await channels(identity)).find(item => item.id === Number(service[1]))
      if (!found)
        throw new BackendError(404, '服务不存在。')
      if (body.status === 1 && capability(found) === 'llm' && localModel(found) && !config.allowLocalLLM)
        throw new BackendError(400, '当前节点禁止启用本机语言模型。')
      await backend(config, identity, `/api/channel/${found.id}/status`, { status: body.status })
      json(response, 200, { ok: true })
      return
    }
    if (path === '/manage/deployment' && request.method === 'POST') {
      if (identity.role < 10)
        throw new BackendError(403, '需要管理员权限。')
      const body = JSON.parse((await bytes(request)).toString())
      // The browser cannot change the backend or open the management listener.
      await applyConfig({ ...config, access: body.access, host: body.host, port: body.port, publicURL: body.publicURL })
      json(response, 200, { ok: true })
      return
    }
    const test = /^\/manage\/try\/(chat|speech|transcribe)$/.exec(path)
    if (test && request.method === 'POST') {
      const key = request.headers['x-anna-device-key']
      if (typeof key !== 'string' || !/^[\w.-]{8,256}$/.test(key))
        throw new BackendError(400, '请粘贴设备 Key，或先创建设备。')
      const body = await bytes(request, 20 * 1024 * 1024)
      if (test[1] === 'chat' && !config.allowLocalLLM && identity.role >= 10) {
        const model = JSON.parse(body.toString()).model
        if ((await channels(identity)).some(item => item.models.split(',').includes(model) && capability(item) === 'llm' && localModel(item)))
          throw new BackendError(400, '此节点上的本地语言模型试用已禁用。')
      }
      const path = { chat: '/v1/chat/completions', speech: '/v1/audio/speech', transcribe: '/v1/audio/transcriptions' }[test[1]]
      const controller = new AbortController()
      const gone = () => controller.abort()
      response.once('close', gone)
      try {
        const target = await fetch(getDataAddress().replace(/\/v1$/, '') + path, { method: 'POST', headers: { 'authorization': `Bearer ${key}`, 'content-type': request.headers['content-type'] || 'application/json' }, body, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]), redirect: 'error' })
        response.statusCode = target.status
        response.setHeader('content-type', target.headers.get('content-type') || 'application/octet-stream')
        response.setHeader('x-request-id', target.headers.get('x-request-id') || '')
        if (target.body)
          await pipeline(Readable.fromWeb(target.body), response)
        else response.end()
      }
      finally { response.removeListener('close', gone) }
      return
    }
    throw new BackendError(404, '接口不存在。')
  }

  return {
    server,
    async bootstrap(username, password) {
      const identity = await login(getConfig(), username, password)
      owner = { identity, expires: Date.now() + age }
      return codeFor(identity)
    },
    ownerCode() { return owner && owner.expires > Date.now() ? codeFor(owner.identity) : undefined },
  }
}
