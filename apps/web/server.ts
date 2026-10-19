import type { ServerResponse } from 'node:http'
import type { AnnaEvent, Command } from '../../packages/shared/contracts'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import process from 'node:process'
import { Host } from '../../packages/anna-host/host'
import { defaultSettings } from '../../packages/anna-host/settings'
import { createPiKernel } from '../../packages/kernels/pi/kernel'
import { webContext } from './policy'

// Test backends are never accepted by the public runtime.
delete process.env.ANNA_TEST_SCRIPT
const modelKey = process.env.ANNA_MODEL_API_KEY ?? ''
const model = process.env.ANNA_MODEL ?? 'Qwen/Qwen3.5-35B-A3B'
const root = resolve(process.env.ANNA_ROOT ?? '.')
const publicDir = resolve(process.env.ANNA_PUBLIC_DIR ?? 'dist/web')
const sessionRoot = resolve(process.env.ANNA_WEB_DATA ?? '/tmp/anna-web-sessions')
const maxSessions = Number(process.env.ANNA_MAX_SESSIONS ?? 30)
const ttl = 2 * 60 * 60 * 1000
interface Visitor { host: Host, clients: Set<ServerResponse>, data: string, touched: number, sends: number[], key: string }
const visitors = new Map<string, Visitor>()
const initializing = new Map<string, Promise<Visitor>>()
const sessionsByIP = new Map<string, number[]>()
const allowed = new Set(['snapshot', 'send', 'connect', 'restart', 'stop', 'new-session', 'character', 'memory', 'memory-forget', 'plugin', 'mode', 'approval', 'rule-remove', 'changes', 'undo', 'configure'])
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.moc3': 'application/octet-stream', '.ico': 'image/x-icon' }

function clean(value: unknown, key = '') {
  let serialized = JSON.stringify(value)
  for (const secret of [modelKey, key]) {
    if (secret)
      serialized = serialized.split(secret).join('[redacted]')
  }
  return serialized
}
function json(response: ServerResponse, status: number, data: unknown, key = '') {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(clean(data, key))
}
async function visitor(token: string): Promise<Visitor> {
  const active = visitors.get(token)
  if (active)
    return active
  const pending = initializing.get(token)
  if (pending)
    return pending
  const task = (async () => {
    const data = join(sessionRoot, token)
    await mkdir(join(data, 'workspace'), { recursive: true, mode: 0o700 })
    // This README is explicitly a demonstration input, never an empirical result.
    await writeFile(join(data, 'workspace', 'README.md'), '# Anna 在线工作区\n\n这是你的独立演示工作区。可让 Anna 写一份计划、创建代码或记住偏好。\n示例文件属于 manually constructed demo input，不是观测数据。\n')
    await writeFile(join(data, 'settings.json'), JSON.stringify({ ...defaultSettings(), model: { provider: 'custom', model, baseURL: 'https://api-inference.modelscope.cn/v1', api: 'openai-completions' } }), { mode: 0o600 })
    let providerSecret = ''
    const entry: Visitor = { host: undefined as unknown as Host, data, clients: new Set(), touched: Date.now(), sends: [], key: modelKey }
    const emit = (event: AnnaEvent) => {
      const frame = `data: ${clean(event, entry.key)}\n\n`
      for (const client of entry.clients) {
        if (!client.write(frame)) {
          client.end()
          entry.clients.delete(client)
        }
      }
    }
    entry.host = new Host(root, data, { read: async () => entry.key, write: async (key) => { entry.key = key } }, emit, {
      kernel: context => createPiKernel(webContext(context)),
      sandbox: { available: false, reason: '在线体验不开放终端，仅支持你的独立工作区文件、记忆和状态。' },
      agents: { detect: async () => [], locate: () => undefined, configDirs: { claude: join(data, 'agents/claude'), codex: join(data, 'agents/codex'), gemini: join(data, 'agents/gemini') }, ccSwitchDb: join(data, 'absent.db') },
      secrets: { read: async () => providerSecret, write: async (value) => { providerSecret = value } },
      secretsMode: async () => 'file',
    })
    await entry.host.initialize()
    visitors.set(token, entry)
    return entry
  })()
  initializing.set(token, task)
  try { return await task }
  finally { initializing.delete(token) }
}

function validateCommand(value: unknown): Command {
  if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string' || !allowed.has(value.type))
    throw new Error('这项功能属于桌面版。在线体验支持对话、伙伴切换、独立工作区文件和记忆。')
  const c = value as Record<string, unknown>
  if (c.type === 'send' && (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 12000 || /^\s*@(?:claude|codex)\b/.test(c.text)))
    throw new Error('请输入 1–12000 字的消息；外部 agent 派活请使用桌面版。')
  if (c.type === 'mode' && !['plan', 'ask', 'edit', 'auto'].includes(String(c.mode)))
    throw new Error('未知权限模式。')
  if (['plugin', 'memory'].includes(String(c.type)) && typeof c.enabled !== 'boolean')
    throw new Error('无效的开关。')
  for (const field of ['id', 'rule', 'taskId']) {
    if (c[field] !== undefined && (typeof c[field] !== 'string' || String(c[field]).length > 1000 || /[\\/]/.test(String(c[field]))))
      throw new Error('无效的标识。')
  }
  if (c.type === 'approval' && (typeof c.allow !== 'boolean' || (c.scope !== undefined && !['once', 'session', 'always'].includes(String(c.scope)))))
    throw new Error('无效的确认。')
  if (c.type === 'configure') {
    if (modelKey)
      throw new Error('演示模型由服务端配置；无需填写密钥。')
    const m = c.model as Record<string, unknown> | undefined
    if (!m || m.baseURL !== 'https://api-inference.modelscope.cn/v1' || m.api !== 'openai-completions' || m.provider !== 'custom' || typeof c.key !== 'string' || c.key.length > 1000)
      throw new Error('在线体验仅连接 ModelScope 免费推理：自定义模型、OpenAI Chat Completions、https://api-inference.modelscope.cn/v1。')
  }
  return c as unknown as Command
}

const server = createServer(async (request, response) => {
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  try {
    const url = new URL(request.url ?? '/', 'http://anna.local')
    const token = typeof request.headers['x-anna-session'] === 'string' ? request.headers['x-anna-session'] : ''
    if (url.pathname === '/healthz')
      return json(response, 200, { status: 'ok', app: 'Anna', modelConfigured: Boolean(modelKey), model })
    if (url.pathname === '/api/session' && request.method === 'POST') {
      if (/^[a-f0-9]{64}$/.test(token) && visitors.has(token))
        return json(response, 200, { session: token })
      if (visitors.size + initializing.size >= maxSessions)
        return json(response, 503, { ok: false, error: '体验人数已满，请稍后再试。' })
      const ip = request.socket.remoteAddress ?? 'unknown'
      const recent = (sessionsByIP.get(ip) ?? []).filter(t => Date.now() - t < 60000)
      if (recent.length >= 20)
        return json(response, 429, { ok: false, error: '请稍后再创建体验会话。' })
      sessionsByIP.set(ip, [...recent, Date.now()])
      const id = randomBytes(32).toString('hex')
      await visitor(id)
      return json(response, 200, { session: id })
    }
    if (url.pathname.startsWith('/api/')) {
      const entry = visitors.get(token)
      if (!entry)
        return json(response, 401, { ok: false, error: '体验会话已到期，请刷新页面。' })
      entry.touched = Date.now()
      if (url.pathname === '/api/events' && request.method === 'GET') {
        if (entry.clients.size >= 3)
          return json(response, 429, { ok: false, error: '连接过多，请刷新页面。' })
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' })
        response.write(`data: ${clean({ type: 'snapshot', snapshot: entry.host.snapshot() }, entry.key)}\n\n`)
        entry.clients.add(response)
        const ping = setInterval(() => { response.write(': keepalive\n\n') }, 15000)
        response.on('close', () => { clearInterval(ping); entry.clients.delete(response) })
        return
      }
      if (url.pathname === '/api/command' && request.method === 'POST') {
        let body = ''
        for await (const chunk of request) {
          body += chunk.toString()
          if (Buffer.byteLength(body) > 64000)
            return json(response, 413, { ok: false, error: '消息过长。' })
        }
        try {
          const command = validateCommand(JSON.parse(body))
          if (command.type === 'send') {
            entry.sends = entry.sends.filter(t => Date.now() - t < 60000)
            if (entry.sends.length >= 8 || entry.host.busy)
              throw new Error('请等待当前对话完成，或稍后再试。')
            entry.sends.push(Date.now())
          }
          return json(response, 200, { ok: true, snapshot: await entry.host.execute(command) }, entry.key)
        }
        catch (error) { return json(response, 400, { ok: false, error: error instanceof Error ? error.message : '请求失败' }, entry.key) }
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
  catch {
    if (!response.headersSent)
      json(response, 500, { ok: false, error: '服务暂时无法处理请求。' }); else response.end()
  }
})
server.requestTimeout = 180000
server.listen(Number(process.env.PORT ?? 7860), '0.0.0.0', () => { console.warn('Anna web listening on port', process.env.PORT ?? 7860) })
setInterval(() => {
  for (const [id, entry] of visitors) {
    if (Date.now() - entry.touched < ttl || entry.host.busy)
      continue
    visitors.delete(id)
    for (const client of entry.clients) client.end()
    void entry.host.close().finally(() => rm(entry.data, { recursive: true, force: true }))
  }
  for (const [ip, recent] of sessionsByIP) {
    if (!recent.some(t => Date.now() - t < 60000))
      sessionsByIP.delete(ip)
  }
}, 60000).unref()
process.on('SIGTERM', () => {
  for (const entry of visitors.values()) void entry.host.close()
  server.close()
})
