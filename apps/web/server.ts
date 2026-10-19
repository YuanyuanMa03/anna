import type { ChildProcess } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AnnaEvent, Command } from '../../packages/shared/contracts'
import type { Wire } from '../../packages/shared/rpc'
import { Buffer } from 'node:buffer'
import { execFile, fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve } from 'node:path'
import process from 'node:process'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { RpcPeer } from '../../packages/shared/rpc'
import { validateCommand } from './commands'
import { providerKeys, seedVisitor } from './seed'

/**
 * The Studio's front door. Each visitor gets a whole Anna in a child process (apps/web/core.ts), under its own Unix
 * user when this server runs as root. The ModelScope key never leaves this process: Anna, Claude Code and Codex reach
 * the model through the relay below with a per-visitor token, so nothing a visitor runs can read the key.
 */
delete process.env.ANNA_TEST_SCRIPT
const modelKey = process.env.ANNA_MODEL_API_KEY ?? ''
delete process.env.ANNA_MODEL_API_KEY
const model = process.env.ANNA_MODEL ?? 'Qwen/Qwen3.5-35B-A3B'
const agentModel = process.env.ANNA_AGENT_MODEL ?? 'Qwen/Qwen3.5-397B-A17B'
/** Tried in order when a model's free quota runs out (HTTP 429): each ModelScope model has its own daily quota. */
const fallbacks = (process.env.ANNA_FALLBACK_MODELS ?? 'Qwen/Qwen3.5-122B-A10B,Qwen/Qwen3.8-Flash-Next,Qwen/Qwen3.8-27B,Qwen/Qwen3.5-27B,Qwen/Qwen3.5-35B-A3B').split(',').map(name => name.trim()).filter(Boolean)
const exhausted = new Map<string, number>()
const upstream = 'https://api-inference.modelscope.cn/v1'
const root = resolve(process.env.ANNA_ROOT ?? '.')
const publicDir = resolve(process.env.ANNA_PUBLIC_DIR ?? 'dist/web')
const sessionRoot = resolve(process.env.ANNA_WEB_DATA ?? '/tmp/anna-web-sessions')
const maxSessions = Number(process.env.ANNA_MAX_SESSIONS ?? 12)
const relayPort = Number(process.env.ANNA_RELAY_PORT ?? 7870)
const relay = `http://127.0.0.1:${relayPort}/v1`
const coreScript = join(dirname(fileURLToPath(import.meta.url)), 'web-core.js')
const asRoot = process.getuid?.() === 0
const ttl = 2 * 60 * 60 * 1000
const run = promisify(execFile)

interface Visitor { id: string, child: ChildProcess, peer: RpcPeer, clients: Set<ServerResponse>, data: string, uid?: number, touched: number, sends: number[], relayToken: string, relayCalls: number[], ready: Promise<void>, closed?: boolean }
const visitors = new Map<string, Visitor>()
const byRelayToken = new Map<string, Visitor>()
const sessionsByIP = new Map<string, number[]>()
const freeUids = Array.from({ length: maxSessions }, (_, i) => 20001 + i)
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.moc3': 'application/octet-stream', '.ico': 'image/x-icon' }

function clean(value: unknown, visitor?: Visitor) {
  let serialized = JSON.stringify(value)
  for (const secret of [modelKey, visitor?.relayToken]) {
    if (secret)
      serialized = serialized.split(secret).join('[redacted]')
  }
  return serialized
}
function json(response: ServerResponse, status: number, data: unknown, visitor?: Visitor) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(clean(data, visitor))
}
function broadcast(visitor: Visitor, event: unknown) {
  const frame = `data: ${clean(event, visitor)}\n\n`
  for (const client of visitor.clients) {
    if (!client.write(frame)) {
      client.end()
      visitor.clients.delete(client)
    }
  }
}

async function close(visitor: Visitor) {
  if (visitor.closed)
    return
  visitor.closed = true
  visitors.delete(visitor.id)
  byRelayToken.delete(visitor.relayToken)
  for (const client of visitor.clients) client.end()
  await visitor.peer.call('shutdown').catch(() => {})
  setTimeout(() => visitor.child.kill('SIGKILL'), 3000).unref()
  await new Promise(resolve => setTimeout(resolve, 500))
  // Stray processes the visitor started (a dev server, a delegated agent) end with the visitor.
  if (visitor.uid !== undefined)
    await run('pkill', ['-KILL', '-u', String(visitor.uid)]).catch(() => {})
  await rm(visitor.data, { recursive: true, force: true }).catch(() => {})
  if (visitor.uid !== undefined)
    freeUids.push(visitor.uid)
}

async function createVisitor(id: string): Promise<Visitor> {
  const data = join(sessionRoot, id)
  const relayToken = randomBytes(24).toString('hex')
  await seedVisitor(data, { relay, model, agentModel })
  await mkdir(join(data, 'home'), { recursive: true })
  await mkdir(join(data, 'tmp'), { recursive: true })
  const uid = asRoot ? freeUids.shift() : undefined
  if (asRoot && uid === undefined)
    throw new Error('体验人数已满，请稍后再试。')
  if (uid !== undefined) {
    await run('chown', ['-R', `${uid}:${uid}`, data])
    await run('chmod', ['700', data])
  }
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
    NODE_ENV: 'production',
    HOME: join(data, 'home'),
    TMPDIR: join(data, 'tmp'),
    ANNA_CORE_ROOT: root,
    ANNA_CORE_DATA: data,
    ANNA_RELAY_TOKEN: relayToken,
    ANNA_PROVIDER_KEYS: providerKeys(relayToken),
    // Delegated agents stay quiet: no telemetry, update checks or other traffic besides the model.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    // Loopback (Anna's routing, the relay) never goes through a proxy, even one the OS configures.
    NO_PROXY: '127.0.0.1,localhost,::1',
    no_proxy: '127.0.0.1,localhost,::1',
  }
  const child = fork(coreScript, [], { env, uid, gid: uid, execArgv: ['--max-old-space-size=384'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'], serialization: 'json' })
  let markReady!: () => void
  let fail!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => { markReady = resolve; fail = reject })
  const visitor: Visitor = { id, child, data, uid, clients: new Set(), touched: Date.now(), sends: [], relayToken, relayCalls: [], ready, peer: undefined as unknown as RpcPeer }
  visitor.peer = new RpcPeer(message => child.send(message), {}, (event: AnnaEvent | { type: 'core', status: string }) => {
    if (event.type === 'core')
      markReady()
    else broadcast(visitor, event)
  })
  child.on('message', message => void visitor.peer.receive(message as Wire))
  child.on('exit', () => {
    visitor.peer.fail('Anna 的会话已结束，请刷新页面。')
    fail(new Error('Anna 启动失败，请稍后刷新。'))
    void close(visitor)
  })
  visitors.set(id, visitor)
  byRelayToken.set(relayToken, visitor)
  const timeout = setTimeout(() => fail(new Error('Anna 启动超时，请稍后刷新。')), 30000)
  try { await ready }
  catch (error) { await close(visitor); throw error }
  finally { clearTimeout(timeout) }
  return visitor
}

function clientIP(request: IncomingMessage) {
  const forwarded = request.headers['x-forwarded-for']
  return (typeof forwarded === 'string' ? forwarded.split(',')[0]!.trim() : '') || request.socket.remoteAddress || 'unknown'
}

async function readBody(request: IncomingMessage, limit: number) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit)
      throw new Error('请求过大。')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString()
}

const server = createServer(async (request, response) => {
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  try {
    const url = new URL(request.url ?? '/', 'http://anna.local')
    const token = typeof request.headers['x-anna-session'] === 'string' ? request.headers['x-anna-session'] : ''
    if (url.pathname === '/healthz')
      return json(response, 200, { status: 'ok', app: 'Anna', modelConfigured: Boolean(modelKey), model, agentModel, visitors: visitors.size, isolation: asRoot ? 'per-visitor user' : 'process' })
    if (url.pathname === '/api/session' && request.method === 'POST') {
      if (/^[a-f0-9]{64}$/.test(token) && visitors.has(token))
        return json(response, 200, { session: token })
      if (!modelKey)
        return json(response, 503, { ok: false, error: '在线体验的模型还没有配置好，请稍后再来。' })
      if (visitors.size >= maxSessions)
        return json(response, 503, { ok: false, error: '体验人数已满，请过几分钟再试。' })
      const ip = clientIP(request)
      const recent = (sessionsByIP.get(ip) ?? []).filter(t => Date.now() - t < 60000)
      if (recent.length >= 6)
        return json(response, 429, { ok: false, error: '请稍后再创建体验会话。' })
      sessionsByIP.set(ip, [...recent, Date.now()])
      const id = randomBytes(32).toString('hex')
      await createVisitor(id)
      return json(response, 200, { session: id })
    }
    if (url.pathname.startsWith('/api/')) {
      const visitor = visitors.get(token)
      if (!visitor)
        return json(response, 401, { ok: false, error: '体验会话已到期，请刷新页面。' })
      visitor.touched = Date.now()
      if (url.pathname === '/api/events' && request.method === 'GET') {
        if (visitor.clients.size >= 3)
          return json(response, 429, { ok: false, error: '连接过多，请刷新页面。' })
        const snapshot = await visitor.peer.call('execute', { type: 'snapshot' })
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' })
        response.write(`data: ${clean({ type: 'snapshot', snapshot }, visitor)}\n\n`)
        visitor.clients.add(response)
        const ping = setInterval(() => { response.write(': keepalive\n\n') }, 15000)
        response.on('close', () => { clearInterval(ping); visitor.clients.delete(response) })
        return
      }
      if (url.pathname === '/api/command' && request.method === 'POST') {
        try {
          const command = validateCommand(JSON.parse(await readBody(request, 64000))) as Command
          if (command.type === 'send') {
            visitor.sends = visitor.sends.filter(t => Date.now() - t < 60000)
            if (visitor.sends.length >= 8)
              throw new Error('发得有点快，请稍等一下再试。')
            visitor.sends.push(Date.now())
          }
          return json(response, 200, { ok: true, snapshot: await visitor.peer.call('execute', command) }, visitor)
        }
        catch (error) { return json(response, 400, { ok: false, error: error instanceof Error ? error.message : '请求失败' }, visitor) }
      }
      return json(response, 404, { ok: false, error: '未知接口' })
    }
    if (!['GET', 'HEAD'].includes(request.method ?? ''))
      return json(response, 405, { ok: false, error: '不支持的请求' })
    const path = resolve(publicDir, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`)
    if (!path.startsWith(`${publicDir}/`) || /(?:^|\/)\./.test(url.pathname))
      return json(response, 404, { ok: false, error: '文件不存在' })
    try {
      const info = await stat(path)
      if (!info.isFile())
        throw new Error('not a file')
      response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': path.endsWith('.html') ? 'no-cache' : 'public, max-age=3600' })
      if (request.method === 'HEAD')
        response.end()
      else createReadStream(path).pipe(response)
    }
    catch { return json(response, 404, { ok: false, error: '文件不存在' }) }
  }
  catch (error) {
    if (!response.headersSent)
      json(response, 500, { ok: false, error: error instanceof Error && /\p{Script=Han}/u.test(error.message) ? error.message : '服务暂时无法处理请求。' })
    else response.end()
  }
})

/**
 * The inference relay, on loopback only: it swaps a visitor's relay token for the Studio's key, allows the two demo
 * models only, and rate-limits each visitor. Responses stream through untouched.
 */
const relayServer = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://relay.local')
    const bearer = (request.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    const apiKey = typeof request.headers['x-api-key'] === 'string' ? request.headers['x-api-key'] : ''
    const visitor = byRelayToken.get(bearer) ?? byRelayToken.get(apiKey)
    if (process.env.ANNA_RELAY_DEBUG)
      console.warn('[relay]', request.method, url.pathname, visitor ? 'visitor' : 'unknown token')
    if (!visitor)
      return json(response, 401, { error: { message: 'unknown relay token' } })
    if (request.method === 'GET' && /\/models$/.test(url.pathname))
      return json(response, 200, { object: 'list', data: [...new Set([model, agentModel, ...fallbacks])].map(id => ({ id, object: 'model', owned_by: 'modelscope' })) })
    if (request.method !== 'POST' || !/\/chat\/completions$/.test(url.pathname))
      return json(response, 404, { error: { message: 'only chat completions are relayed' } })
    visitor.touched = Date.now()
    visitor.relayCalls = visitor.relayCalls.filter(t => Date.now() - t < 60000)
    if (visitor.relayCalls.length >= 30)
      return json(response, 429, { error: { message: '在线体验的模型调用太频繁了，请稍等一分钟。' } })
    visitor.relayCalls.push(Date.now())
    const body = JSON.parse(await readBody(request, 4_000_000)) as Record<string, unknown>
    const requested = [model, agentModel].includes(String(body.model)) ? String(body.model) : agentModel
    // Skip models that ran out of quota in the last ten minutes, then fall back in order.
    const candidates = [...new Set([requested, ...fallbacks])].filter(name => Date.now() - (exhausted.get(name) ?? 0) > 600000)
    let upstreamResponse: Response | undefined
    for (const name of candidates.length ? candidates : [requested]) {
      body.model = name
      try {
        upstreamResponse = await fetch(`${upstream}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${modelKey}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(600000) })
      }
      catch (error) {
        // A dropped connection before any answer: try the next model rather than failing the visitor's turn.
        console.error('[relay] upstream unreachable with', name, error instanceof Error ? error.message : error)
        continue
      }
      if (upstreamResponse.status !== 429)
        break
      exhausted.set(name, Date.now())
      console.error('[relay] quota exhausted, falling back:', name)
      await upstreamResponse.body?.cancel()
    }
    if (!upstreamResponse)
      throw new Error('no upstream response')
    if (upstreamResponse.status === 429) {
      response.writeHead(429, { 'Content-Type': 'application/json' })
      return response.end(JSON.stringify({ error: { message: `在线体验今天的免费模型额度用完了，请明天再来，或下载桌面版接上自己的模型。` } }))
    }
    if (!upstreamResponse.ok) {
      const text = (await upstreamResponse.text()).split(modelKey).join('[redacted]')
      console.error('[relay] upstream', upstreamResponse.status, String(body.model), text.slice(0, 400))
      response.writeHead(upstreamResponse.status, { 'Content-Type': upstreamResponse.headers.get('content-type') ?? 'application/json' })
      return response.end(text)
    }
    response.writeHead(upstreamResponse.status, { 'Content-Type': upstreamResponse.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' })
    if (!upstreamResponse.body)
      return response.end()
    const stream = Readable.fromWeb(upstreamResponse.body as never)
    request.on('close', () => stream.destroy())
    stream.on('error', () => response.end())
    stream.pipe(response)
  }
  catch (error) {
    console.error('[relay]', error instanceof Error ? `${error.name}: ${error.message}${error.cause ? ` (${String((error.cause as Error).message ?? error.cause)})` : ''}` : error)
    if (!response.headersSent)
      json(response, 502, { error: { message: 'ModelScope 推理暂时不可用，请稍后再试。' } })
    else response.end()
  }
})

server.requestTimeout = 0
/**
 * With ANNA_SELF_TEST set, one throwaway visitor runs `npm test` in the demo project in "auto" mode at startup and the
 * outcome goes to the run log: the Studio's own proof that per-visitor users, the sandbox and the relay work there.
 */
async function selfTest() {
  const visitor = await createVisitor(randomBytes(32).toString('hex'))
  try {
    interface Snap { platform: { sandbox: unknown }, agents: { detected: { id: string, installed: boolean, version?: string }[] }, anna: { phase: string }, approvals: { id: string, details?: string }[], messages: { role: string, text?: string }[] }
    const execute = (command: unknown) => visitor.peer.call<Snap>('execute', command)
    const first = await execute({ type: 'snapshot' })
    console.warn('[self-test] uid', visitor.uid ?? 'shared', 'sandbox', JSON.stringify(first.platform.sandbox), 'agents', JSON.stringify(first.agents.detected.filter(agent => agent.installed).map(agent => `${agent.id}@${agent.version}`)))
    await execute({ type: 'mode', mode: 'auto' })
    await execute({ type: 'send', text: process.env.ANNA_SELF_TEST_TEXT || '运行 npm test，用一句话告诉我结果。' })
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000))
      const now = await execute({ type: 'snapshot' })
      for (const approval of now.approvals) {
        console.warn('[self-test] approving', JSON.stringify(approval.details ?? '').slice(0, 160))
        await execute({ type: 'approval', id: approval.id, allow: true, scope: 'session' })
      }
      if (['done', 'failed', 'idle'].includes(now.anna.phase) && i > 0) {
        console.warn('[self-test]', now.anna.phase, JSON.stringify(now.messages.at(-1)?.text ?? '').slice(0, 400), 'agents', JSON.stringify(now.agents.detected.filter(agent => agent.installed).map(agent => `${agent.id}@${agent.version}`)))
        return
      }
    }
    console.warn('[self-test] timed out')
  }
  catch (error) { console.error('[self-test] failed', error instanceof Error ? error.message : error) }
  finally { await close(visitor) }
}

void mkdir(sessionRoot, { recursive: true, mode: 0o711 }).then(() => {
  relayServer.listen(relayPort, '127.0.0.1')
  server.listen(Number(process.env.PORT ?? 7860), '0.0.0.0', () => {
    console.warn('Anna web listening on port', process.env.PORT ?? 7860, asRoot ? '(per-visitor users)' : '(single user)')
    if (process.env.ANNA_SELF_TEST && modelKey)
      void selfTest()
  })
})
setInterval(() => {
  for (const visitor of visitors.values()) {
    if (Date.now() - visitor.touched < ttl)
      continue
    void visitor.peer.call<boolean>('busy').catch(() => false).then(busy => busy ? undefined : close(visitor))
  }
  for (const [ip, recent] of sessionsByIP) {
    if (!recent.some(t => Date.now() - t < 60000))
      sessionsByIP.delete(ip)
  }
}, 60000).unref()
process.on('SIGTERM', () => {
  for (const visitor of visitors.values()) void close(visitor)
  server.close()
  relayServer.close()
  setTimeout(() => process.exit(0), 4000).unref()
})
