import { Buffer } from 'node:buffer'
import { createServer, request as httpRequest } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'

const serverModule = pathToFileURL(resolve('packages/gateway/server.mjs')).href
const workbenchModule = pathToFileURL(resolve('packages/gateway/workbench.mjs')).href
const configModule = pathToFileURL(resolve('packages/gateway/config.mjs')).href
const { listen, close, gatewayServer } = await import(serverModule)
const { workbenchServer } = await import(workbenchModule)
const { defaults, validateConfig } = await import(configModule)

async function fixture() {
  let device = { id: 7, name: 'Old device', key: 'masked-key', status: 1, expired_time: 1234567890, remain_quota: 100, unlimited_quota: false, model_limits_enabled: true, model_limits: 'kokoro-local', allow_ips: '127.0.0.1', group: 'default', cross_group_retry: false, allow_user_quota_query: false }
  const channels = [{ id: 1, name: '<script>cloud</script>', models: 'cloud-model', key: 'never-return-provider-key', status: 1, type: 1, base_url: 'https://provider.invalid' }, { id: 2, name: '本地 Qwen', models: 'qwen3-4b', status: 2, type: 1, base_url: 'http://127.0.0.1:17862' }]
  const seen: { path: string, method: string | undefined, body: any, user: string | string[] | undefined }[] = []
  const provider = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString()
    let body
    try { body = raw ? JSON.parse(raw) : {} }
    catch { body = raw }
    const url = new URL(request.url!, 'http://localhost')
    seen.push({ path: url.pathname, method: request.method, body, user: request.headers['new-api-user'] })
    response.setHeader('content-type', 'application/json')
    const ok = (data: any) => response.end(JSON.stringify({ success: true, data }))
    if (url.pathname === '/api/user/login') {
      if (body.password !== 'correct') { response.statusCode = 401; response.end('{"success":false,"message":"private auth diagnostics"}'); return }
      ok({ access_token: body.username === 'viewer' ? 'viewer-jwt-private' : 'owner-jwt-private', user: { id: body.username === 'viewer' ? 2 : 1, role: body.username === 'viewer' ? 1 : 100, username: body.username } }); return
    }
    if (url.pathname.startsWith('/v1/')) {
      if (request.headers.authorization !== 'Bearer sk-one-device-key') { response.statusCode = 401; ok({ error: 'rejected' }); return }
      ok({ text: '你好' }); return
    }
    if (!['Bearer owner-jwt-private', 'Bearer viewer-jwt-private'].includes(request.headers.authorization || '')) { response.statusCode = 401; response.end('{}'); return }
    if (url.pathname === '/api/user/self') { ok({ quota: 1000, used_quota: 30, request_count: 2, password: 'never-return-user-password' }); return }
    if (url.pathname === '/api/channel/' && request.method === 'GET') { ok({ items: channels, total: channels.length }); return }
    if (url.pathname === '/api/token/' && request.method === 'GET') { ok({ items: [device], total: 1 }); return }
    if (url.pathname === '/api/log/self') { ok({ items: [{ id: 1, created_at: 123, type: 2, token_name: 'Old device', model_name: 'cloud-model', prompt_tokens: 5, completion_tokens: 1, quota: 8, content: 'never-return-private-prompt', other: 'never-return-internals' }], total: 1 }); return }
    if (url.pathname === '/api/token/7' && request.method === 'GET') { ok(device); return }
    if (url.pathname === '/api/token/' && request.method === 'PUT') { device = { ...device, ...body }; ok({}); return }
    if (url.pathname === '/api/token/' && request.method === 'POST') { device = { ...device, ...body }; ok({}); return }
    if (url.pathname === '/api/token/search') { ok({ items: [device], total: 1 }); return }
    if (url.pathname === '/api/token/7/key') { ok({ key: 'one-device-key' }); return }
    if (url.pathname === '/api/channel/' && request.method === 'POST') { ok({}); return }
    if (/^\/api\/channel\/\d+\/status$/.test(url.pathname)) { ok({}); return }
    response.statusCode = 404; response.end('{}')
  })
  const providerPort = await listen(provider, '127.0.0.1', 0)
  let config = { ...defaults, backendURL: `http://127.0.0.1:${providerPort}` }
  const gateway = gatewayServer(config)
  const port = await listen(gateway.server, '127.0.0.1', 0)
  const manager = workbenchServer({ getConfig: () => config, getDataAddress: () => `http://127.0.0.1:${port}/v1`, applyConfig: async (value: object) => { config = validateConfig(value) } })
  const consolePort = await listen(manager.server, '127.0.0.1', 0)
  const url = `http://127.0.0.1:${consolePort}`
  onTestFinished(async () => { await close(manager.server); await gateway.stop(); await close(provider) })
  const call = async (path: string, token = '', body?: object) => fetch(url + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const signIn = async (username = 'owner') => (await (await call('/manage/login', '', { username, password: 'correct' })).json()).token as string
  return { manager, url, call, signIn, seen, channels }
}

it('serves only known assets with a strict CSP and rejects hostile Host/Origin', async () => {
  const f = await fixture()
  const index = await fetch(f.url)
  expect(await index.text()).toContain('Anna · 服务工作台')
  expect(index.headers.get('content-security-policy')).toContain('script-src \'self\'')
  expect((await fetch(`${f.url}/workbench.js`)).headers.get('content-type')).toContain('javascript')
  expect((await fetch(`${f.url}/anna.svg`)).status).toBe(200)
  const hostileHost = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(f.url, { headers: { host: 'evil.invalid' } }, (response) => { response.resume(); resolve(response.statusCode!) })
    request.once('error', reject); request.end()
  })
  expect(hostileHost).toBe(403)
  expect((await fetch(f.url, { headers: { origin: 'https://evil.invalid' } })).status).toBe(403)
  expect((await f.call('/manage/snapshot')).status).toBe(401)
  expect((await f.call('/api/token/')).status).toBe(401)
})

it('exchanges login for an opaque local session and redacts private upstream fields', async () => {
  const f = await fixture()
  const failed = await f.call('/manage/login', '', { username: 'owner', password: 'bad' })
  expect(failed.status).toBe(401)
  expect(await failed.text()).not.toContain('private auth diagnostics')
  const token = await f.signIn()
  expect(token).not.toContain('jwt')
  const response = await f.call('/manage/snapshot', token)
  const snapshot = await response.json()
  expect(snapshot.services.items[0].name).toContain('<script>') // Rendering is escaped by the UI, not replaced in storage.
  expect(snapshot.devices.items[0]).toMatchObject({ id: 7, remaining: 100 })
  expect(JSON.stringify(snapshot)).not.toMatch(/never-return|masked-key|owner-jwt|backendURL/)
  await f.call('/manage/logout', token, {})
  expect((await f.call('/manage/snapshot', token)).status).toBe(401)
})

it('uses each user identity and rejects ordinary users from service/network administration', async () => {
  const f = await fixture()
  const token = await f.signIn('viewer')
  const snapshot = await (await f.call('/manage/snapshot', token)).json()
  expect(snapshot.user.admin).toBe(false)
  expect(snapshot.services.items).toEqual([])
  expect(f.seen.find(item => item.path === '/api/user/self')!.user).toBe('2')
  expect((await f.call('/manage/services', token, {})).status).toBe(403)
  expect((await f.call('/manage/deployment', token, {})).status).toBe(403)
  expect(f.seen.some(item => item.path === '/api/channel/')).toBe(false)
})

it('restores a browser session with an HttpOnly cookie and clears it on logout', async () => {
  const f = await fixture()
  const signed = await f.call('/manage/login', '', { username: 'owner', password: 'correct' })
  const header = signed.headers.get('set-cookie')!
  expect(header).toContain('HttpOnly; SameSite=Strict; Path=/manage')
  const cookie = header.split(';')[0]!
  const restored = await (await fetch(`${f.url}/manage/session`, { headers: { cookie } })).json()
  expect(restored).toMatchObject({ loggedIn: true, token: expect.any(String) })
  expect((await fetch(`${f.url}/manage/snapshot`, { headers: { cookie, authorization: 'Bearer device-key' } })).status).toBe(401)
  const out = await f.call('/manage/logout', restored.token, {})
  expect(out.headers.get('set-cookie')).toContain('Max-Age=0')
  expect(await (await fetch(`${f.url}/manage/session`, { headers: { cookie } })).json()).toEqual({ loggedIn: false })
})

it('creates a scoped device and returns only its newly created key once', async () => {
  const f = await fixture()
  const token = await f.signIn()
  const response = await f.call('/manage/devices', token, { name: 'My laptop', models: ['cloud-model'], remaining: 500, days: 10 })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ key: 'sk-one-device-key', device: { remaining: 500, models: 'cloud-model' } })
  const created = f.seen.find(item => item.path === '/api/token/' && item.method === 'POST')!
  expect(created.body).toMatchObject({ unlimited_quota: false, model_limits_enabled: true, allow_user_quota_query: false, model_limits: 'cloud-model' })
  const longName = await f.call('/manage/devices', token, { name: '中文设备'.repeat(10), models: ['cloud-model'], remaining: 50, days: 10 })
  expect(longName.status).toBe(200)
  const named = f.seen.filter(item => item.path === '/api/token/' && item.method === 'POST').at(-1)!
  expect(Buffer.byteLength(named.body.name)).toBeLessThanOrEqual(50)
  const state = await (await f.call('/manage/snapshot', token)).text()
  expect(state).not.toContain('one-device-key')
  expect((await f.call('/manage/devices', token, { name: 'bad', remaining: -1, models: [] })).status).toBe(400)
})

it('updates remaining quota without erasing device scope, expiry or IP restrictions', async () => {
  const f = await fixture()
  const token = await f.signIn()
  expect((await f.call('/manage/devices/7/quota', token, { remaining: 900 })).status).toBe(200)
  const changed = f.seen.find(item => item.path === '/api/token/' && item.method === 'PUT')!.body
  expect(changed).toMatchObject({ id: 7, name: 'Old device', remain_quota: 900, expired_time: 1234567890, model_limits_enabled: true, model_limits: 'kokoro-local', allow_ips: '127.0.0.1', group: 'default', unlimited_quota: false })
  expect(changed.key).toBeUndefined()
  expect((await f.call('/manage/devices/7/revoke', token, {})).status).toBe(200)
  expect(f.seen.at(-1)).toMatchObject({ method: 'PUT', body: { id: 7, status: 2 } })
})

it('blocks current-node LLM activation and persists provider credentials only in the backend', async () => {
  const f = await fixture()
  const token = await f.signIn()
  expect((await f.call('/manage/services/2/status', token, { status: 1 })).status).toBe(400)
  expect((await f.call('/manage/services', token, { name: 'unsafe', kind: 'llm', baseURL: 'http://127.0.0.1:17862', models: 'qwen3-4b', key: '' })).status).toBe(400)
  const response = await f.call('/manage/services', token, { name: 'cloud', kind: 'llm', baseURL: 'https://provider.invalid', models: 'cloud-model', key: 'private-new-provider-key' })
  expect(response.status).toBe(200)
  expect(await response.text()).not.toContain('private-new-provider-key')
  expect(f.seen.find(item => item.path === '/api/channel/' && item.method === 'POST')!.body.channel).toMatchObject({ type: 1, key: 'private-new-provider-key', remark: 'anna:llm' })
  expect((await f.call('/manage/services', token, { name: 'LAN model', kind: 'llm', baseURL: 'http://192.168.1.8:11434', models: 'small-model', key: '' })).status).toBe(200)
})

it('redeems short-lived owner links once without exposing the upstream access token', async () => {
  const f = await fixture()
  expect(f.manager.ownerCode()).toBeUndefined()
  const code = await f.manager.bootstrap('owner', 'correct')
  const first = await f.call('/manage/redeem', '', { code })
  expect(first.status).toBe(200)
  expect(await first.text()).not.toMatch(/jwt-private|correct/)
  expect((await f.call('/manage/redeem', '', { code })).status).toBe(401)
  const ownerCode = f.manager.ownerCode()
  expect((await f.call('/manage/redeem', '', { code: ownerCode })).status).toBe(200)
  const ownerSession = await f.signIn()
  await f.call('/manage/logout', ownerSession, {})
  expect(f.manager.ownerCode()).toBeUndefined()
})

it('runs tests through device-key data plane and never substitutes the admin credential', async () => {
  const f = await fixture()
  const token = await f.signIn()
  const response = await fetch(`${f.url}/manage/try/speech`, { method: 'POST', headers: { 'authorization': `Bearer ${token}`, 'x-anna-device-key': 'sk-one-device-key', 'content-type': 'application/json' }, body: '{"model":"kokoro-local","input":"你好"}' })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ data: { text: '你好' } })
  const calls = f.seen.filter(item => item.path.startsWith('/v1/'))
  expect(calls).toHaveLength(1)
  expect(calls[0]!.user).toBeUndefined()
})
