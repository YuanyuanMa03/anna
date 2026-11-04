import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const routes = new Map([
  ['/v1/models', 'GET'],
  ['/v1/chat/completions', 'POST'],
  ['/v1/audio/transcriptions', 'POST'],
  ['/v1/audio/speech', 'POST'],
])
const maxBytes = 20 * 1024 * 1024
const maxConcurrent = 4
const timeoutMs = 120_000

export function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  response.end(JSON.stringify(value))
}

export function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const failed = error => reject(error)
    server.once('error', failed)
    server.listen(port, host, () => {
      server.removeListener('error', failed)
      resolve(server.address().port)
    })
  })
}

export async function close(server) {
  if (!server.listening)
    return
  const closed = new Promise(resolve => server.close(resolve))
  server.closeAllConnections()
  await closed
}

/** Data plane only. New API remains the authority for device keys, quotas and usage. */
export function gatewayServer(config, log = () => {}) {
  const controllers = new Set()
  const server = createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent)
        json(response, 500, { error: { message: '网关无法完成请求。', type: 'gateway_error' } })
      else
        response.destroy()
    })
  })
  server.headersTimeout = 10_000
  server.requestTimeout = timeoutMs

  async function handle(request, response) {
    const path = request.url
    if (path === '/healthz' && request.method === 'GET') {
      json(response, 200, { service: 'anna-gateway', version: 1, status: 'listening' })
      return
    }
    if (!routes.has(path)) {
      json(response, 404, { error: { message: '接口不存在。', type: 'not_found' } })
      return
    }
    if (request.method !== routes.get(path)) {
      response.setHeader('allow', routes.get(path))
      json(response, 405, { error: { message: '请求方法不支持。', type: 'method_not_allowed' } })
      return
    }
    if (request.headers.origin !== undefined || !/^Bearer [\w.-]+$/i.test(request.headers.authorization || '')) {
      json(response, 401, { error: { message: '需要有效的设备密钥；数据接口不接受浏览器跨域调用。', type: 'authentication_error' } })
      return
    }
    if (controllers.size >= maxConcurrent) {
      response.setHeader('retry-after', '2')
      json(response, 503, { error: { message: '网关正忙，请稍后重试。', type: 'gateway_busy' } })
      return
    }
    const controller = new AbortController()
    controllers.add(controller)
    const id = randomUUID()
    const started = Date.now()
    let failure
    const timer = setTimeout(() => { failure = 'timeout'; controller.abort() }, timeoutMs)
    controller.signal.addEventListener('abort', () => {
      if (!request.complete)
        request.destroy()
    }, { once: true })
    const disconnected = () => controller.abort()
    request.once('aborted', disconnected)
    response.once('close', disconnected)
    response.setHeader('x-request-id', id)
    try {
      if (Number(request.headers['content-length']) > maxBytes) {
        request.resume()
        response.setHeader('connection', 'close')
        json(response, 413, { error: { message: '请求不能超过 20 MiB。', type: 'request_too_large' } })
        return
      }
      const chunks = []
      let bytes = 0
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        bytes += chunk.length
        if (bytes > maxBytes) {
          request.resume()
          response.setHeader('connection', 'close')
          json(response, 413, { error: { message: '请求不能超过 20 MiB。', type: 'request_too_large' } })
          return
        }
        chunks.push(chunk)
      }
      const headers = { authorization: request.headers.authorization }
      for (const key of ['content-type', 'accept']) {
        if (request.headers[key])
          headers[key] = request.headers[key]
      }
      const upstream = await fetch(`${config.backendURL}${path}`, {
        method: request.method,
        headers,
        ...(request.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
        signal: controller.signal,
        redirect: 'manual',
      })
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel()
        failure = 'redirect'
        json(response, 502, { error: { message: '后端返回了不受支持的重定向。', type: 'backend_error' } })
        return
      }
      response.statusCode = upstream.status
      response.setHeader('cache-control', 'no-store')
      response.setHeader('x-content-type-options', 'nosniff')
      // No cookies, backend authentication challenges, redirects or internal headers cross the boundary.
      for (const key of ['content-type', 'retry-after']) {
        const value = upstream.headers.get(key)
        if (value)
          response.setHeader(key, value)
      }
      if (upstream.body)
        await pipeline(Readable.fromWeb(upstream.body), response)
      else
        response.end()
    }
    catch {
      failure ??= controller.signal.aborted ? 'cancelled' : 'backend'
      if (!response.destroyed && !response.headersSent)
        json(response, failure === 'timeout' ? 504 : 502, { error: { message: failure === 'timeout' ? '后端请求超时。' : '后端不可用或请求已取消。', type: 'backend_error' } })
      else
        response.destroy()
    }
    finally {
      clearTimeout(timer)
      controllers.delete(controller)
      request.removeListener('aborted', disconnected)
      response.removeListener('close', disconnected)
      // Fixed fields only: no key, body, upstream URL, filename or provider error text.
      log({ id, path, status: response.statusCode, durationMs: Date.now() - started, ...(failure ? { failure } : {}) })
    }
  }

  return {
    server,
    async stop() {
      for (const controller of controllers)
        controller.abort()
      await close(server)
    },
  }
}
