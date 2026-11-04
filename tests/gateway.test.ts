import type { ChildProcess } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { expect, it, onTestFinished, vi } from 'vitest'

// Dynamic URLs keep the zero-dependency native Node entrypoint separate from the desktop TS build.
const serverURL = pathToFileURL(resolve('packages/gateway/server.mjs')).href
const configURL = pathToFileURL(resolve('packages/gateway/config.mjs')).href
const { gatewayServer, listen, close } = await import(serverURL)
const { initialize, loadConfig, validateConfig, defaults, dataDirectory } = await import(configURL)
const run = promisify(execFile)
const cli = resolve('apps/gateway/cli.mjs')

async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'anna 网关 space-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function fixture(reply: (request: IncomingMessage, response: ServerResponse, body: Buffer) => void) {
  const seen: { path: string | undefined, headers: IncomingMessage['headers'], body: Buffer }[] = []
  const backend = createServer(async (request, response) => {
    const parts = []
    for await (const chunk of request)
      parts.push(chunk)
    const body = Buffer.concat(parts)
    seen.push({ path: request.url, headers: request.headers, body })
    reply(request, response, body)
  })
  const backendURL = `http://127.0.0.1:${await listen(backend, '127.0.0.1', 0)}`
  const records: object[] = []
  const gateway = gatewayServer({ backendURL }, (record: object) => records.push(record))
  const url = `http://127.0.0.1:${await listen(gateway.server, '127.0.0.1', 0)}`
  onTestFinished(async () => { await gateway.stop(); await close(backend) })
  return { backendURL, url, seen, records, gateway }
}

const auth = { authorization: 'Bearer sk-device-preserved' }
const chat = { model: 'anna-chat', messages: [{ role: 'user', content: 'private prompt' }] }
const post = (url: string, path = '/v1/chat/completions', body = JSON.stringify(chat), headers = {}) => fetch(url + path, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', ...headers }, body })

it('requires explicit network publishing and validates config without embedded secrets', () => {
  expect(validateConfig(defaults)).toMatchObject({ access: 'local', host: '127.0.0.1' })
  expect(() => validateConfig({ ...defaults, host: '0.0.0.0' })).toThrow(/network/)
  expect(validateConfig({ ...defaults, access: 'network', host: '0.0.0.0' })).toMatchObject({ access: 'network' })
  expect(validateConfig({ ...defaults, backendURL: 'http://192.168.1.2:17860' })).toMatchObject({ backendURL: 'http://192.168.1.2:17860' })
  for (const backendURL of ['file:///tmp/a', 'http://user:secret@localhost:17860', 'https://example.com/v1', 'http://203.0.113.2:17860', 'http://127.0.0.1:17864'])
    expect(() => validateConfig({ ...defaults, backendURL })).toThrow()
  expect(() => validateConfig({ ...defaults, host: 'bad' })).toThrow()
  expect(() => validateConfig({ ...defaults, port: 70000 })).toThrow()
  expect(dataDirectory('win32', { LOCALAPPDATA: '/fixture/local' }, '/fixture/home')).toBe(join('/fixture/local', 'Anna', 'Gateway'))
  expect(dataDirectory('darwin', {}, '/fixture/home')).toBe(join('/fixture/home', 'Library', 'Application Support', 'Anna', 'Gateway'))
  expect(dataDirectory('linux', { XDG_DATA_HOME: '/fixture/data' }, '/fixture/home')).toBe(join('/fixture/data', 'anna', 'gateway'))
  expect(dataDirectory('linux', { XDG_DATA_HOME: 'relative' }, '/fixture/home')).toBe(join('/fixture/home', '.local', 'share', 'anna', 'gateway'))
})

it('initializes in paths containing Chinese/spaces without overwriting configuration', async () => {
  const dir = await directory()
  await initialize(dir)
  const before = await readFile(join(dir, 'gateway.json'), 'utf8')
  expect(await loadConfig(dir)).toMatchObject({ port: 17864 })
  await expect(initialize(dir)).rejects.toMatchObject({ code: 'EEXIST' })
  expect(await readFile(join(dir, 'gateway.json'), 'utf8')).toBe(before)
  if (process.platform !== 'win32')
    expect((await stat(join(dir, 'gateway.json'))).mode & 0o777).toBe(0o600)
  await writeFile(join(dir, 'gateway.json'), '{"accidental-secret":"never-show-this"')
  await expect(loadConfig(dir)).rejects.toThrow('gateway.json 不是有效 JSON；未输出配置内容。')
})

it('exposes only inference routes, refuses browser/missing keys and never proxies management', async () => {
  const f = await fixture((_request, response) => response.end('{}'))
  expect(await (await fetch(`${f.url}/healthz`)).json()).toMatchObject({ service: 'anna-gateway', status: 'listening' })
  for (const path of ['/api/user/self', '/api/token/', '/stop', '/v1/models?admin=true', 'http://example.com/v1/models'])
    expect((await fetch(f.url + (path.startsWith('http') ? `/${path}` : path), { headers: auth })).status).toBe(404)
  expect((await fetch(`${f.url}/v1/models`)).status).toBe(401)
  expect((await fetch(`${f.url}/v1/models`, { headers: { ...auth, origin: f.url } })).status).toBe(401)
  expect((await post(f.url, '/v1/models')).status).toBe(405)
  expect(f.seen).toHaveLength(0)
})

it('preserves device key, SSE and actual usage while excluding cookies and private logs', async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: {"usage":{"prompt_tokens":7,"completion_tokens":1}}\n\ndata: [DONE]\n\n'
  const f = await fixture((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'set-cookie': 'admin=private', 'x-internal': 'private' })
    response.end(sse)
  })
  const result = await post(f.url, '/v1/chat/completions', JSON.stringify({ ...chat, stream: true }), { 'cookie': 'personal-login', 'x-forwarded-for': 'private-address' })
  expect(await result.text()).toBe(sse)
  expect(result.headers.get('x-request-id')).toBeTruthy()
  expect(result.headers.get('set-cookie')).toBeNull()
  expect(result.headers.get('x-internal')).toBeNull()
  expect(f.seen[0]!.headers.authorization).toBe(auth.authorization)
  expect(f.seen[0]!.headers.cookie).toBeUndefined()
  expect(f.seen[0]!.headers['x-forwarded-for']).toBeUndefined()
  expect(JSON.parse(f.seen[0]!.body.toString())).toMatchObject(chat)
  await expect.poll(() => f.records.length).toBe(1)
  expect(JSON.stringify(f.records)).not.toMatch(/sk-device|private|messages|backendURL/)
})

it('preserves existing backend key/quota errors without inventing a new ledger', async () => {
  const f = await fixture((request, response) => {
    response.writeHead(request.headers.authorization === 'Bearer revoked' ? 401 : 429, { 'content-type': 'application/json', 'retry-after': '8' })
    response.end('{"error":{"message":"backend key or quota rejected"}}')
  })
  expect((await post(f.url, undefined, undefined, { authorization: 'Bearer revoked' })).status).toBe(401)
  const quota = await post(f.url)
  expect(quota.status).toBe(429)
  expect(quota.headers.get('retry-after')).toBe('8')
  expect(await quota.json()).toMatchObject({ error: { message: 'backend key or quota rejected' } })
})

it('forwards multipart ASR and binary TTS without decoding, logging or playback', async () => {
  const f = await fixture((request, response, body) => {
    if (request.url === '/v1/audio/transcriptions') {
      expect(body.toString()).toContain('fake-audio-bytes')
      response.setHeader('content-type', 'application/json')
      response.end('{"text":"你好"}')
    }
    else {
      response.setHeader('content-type', 'audio/wav')
      response.end(Buffer.from([82, 73, 70, 70, 0, 255, 1]))
    }
  })
  const form = new FormData()
  form.set('model', 'anna-asr')
  form.set('file', new Blob(['fake-audio-bytes'], { type: 'audio/wav' }), '录音 space.wav')
  const asr = await fetch(`${f.url}/v1/audio/transcriptions`, { method: 'POST', headers: auth, body: form })
  expect(await asr.json()).toEqual({ text: '你好' })
  expect(f.seen[0]!.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
  const tts = await post(f.url, '/v1/audio/speech', JSON.stringify({ model: 'anna-tts', input: '你好', voice: 'anna' }))
  expect(tts.headers.get('content-type')).toBe('audio/wav')
  expect(Buffer.from(await tts.arrayBuffer())).toEqual(Buffer.from([82, 73, 70, 70, 0, 255, 1]))
})

it('does not follow redirects or leak a device key to a second target', async () => {
  let redirected = 0
  const target = createServer((_request, response) => { redirected++; response.end('unexpected') })
  const port = await listen(target, '127.0.0.1', 0)
  onTestFinished(() => close(target))
  const f = await fixture((_request, response) => { response.writeHead(307, { location: `http://127.0.0.1:${port}/api/token` }); response.end() })
  expect((await post(f.url)).status).toBe(502)
  expect(redirected).toBe(0)
  expect(f.seen).toHaveLength(1)
})

it('bounds declared and chunked uploads before they reach any model', async () => {
  const f = await fixture((_request, response) => response.end('{}'))
  const declared = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${f.url}/v1/audio/transcriptions`, { method: 'POST', headers: { ...auth, 'content-length': 21 * 1024 * 1024 } }, (response) => { response.resume(); resolve(response.statusCode!) })
    request.on('error', reject)
    request.end()
  })
  expect(declared).toBe(413)
  const streamed = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${f.url}/v1/audio/transcriptions`, { method: 'POST', headers: { ...auth, 'transfer-encoding': 'chunked' } }, (response) => { response.resume(); resolve(response.statusCode!) })
    request.on('error', reject)
    request.end(Buffer.alloc(20 * 1024 * 1024 + 1))
  })
  expect(streamed).toBe(413)
  expect(f.seen).toHaveLength(0)
})

it('streams incrementally and cancels upstream when a client leaves', async () => {
  let ended = false
  const f = await fixture((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: first\n\n')
    response.on('close', () => { ended = true })
  })
  const controller = new AbortController()
  const response = await fetch(`${f.url}/v1/chat/completions`, { method: 'POST', headers: auth, body: '{}', signal: controller.signal })
  expect(new TextDecoder().decode((await response.body!.getReader().read()).value)).toContain('first')
  controller.abort()
  await expect.poll(() => ended).toBe(true)
})

it('limits concurrency, rejects excess work and cancels all requests on stop', async () => {
  const f = await fixture((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: pending\n\n')
  })
  const responses = await Promise.all(Array.from({ length: 4 }, () => post(f.url)))
  expect((await post(f.url)).status).toBe(503)
  expect(f.seen).toHaveLength(4)
  await f.gateway.stop()
  await Promise.all(responses.map(response => response.body!.cancel().catch(() => {})))
})

it('reports unavailable backends without exposing provider addresses or stack traces', async () => {
  const f = await fixture((_request, response) => response.destroy())
  const response = await post(f.url)
  expect(response.status).toBe(502)
  expect(await response.text()).not.toMatch(/127\.0\.0\.1|fetch|stack|sk-device/)
})

it('times out a stalled backend without retrying and cancels its connection', async () => {
  let cancelled = false
  const f = await fixture((_request, response) => { response.on('close', () => { cancelled = true }) })
  const original = globalThis.setTimeout
  let expire: (() => void) | undefined
  // Fire the actual deadline callback after the backend receives the request, independent of machine speed.
  const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: Parameters<typeof setTimeout>[0], delay?: number, ...args: unknown[]) => {
    if (delay === 120_000)
      expire = () => callback(...args)
    return original(callback, delay, ...args)
  }) as typeof setTimeout)
  onTestFinished(() => timer.mockRestore())
  const pending = post(f.url)
  await expect.poll(() => f.seen.length).toBe(1)
  expect(expire).toBeTypeOf('function')
  expire!()
  const response = await pending
  expect(response.status).toBe(504)
  await expect.poll(() => cancelled).toBe(true)
  expect(f.seen).toHaveLength(1)
  expect(f.records).toMatchObject([{ failure: 'timeout', status: 504 }])
})

it('cleans up a failed bind and preserves an unverified stale instance record', async () => {
  const dir = await directory()
  const f = await fixture((_request, response) => response.end('{}'))
  await initialize(dir)
  await writeFile(join(dir, 'gateway.json'), JSON.stringify({ ...defaults, backendURL: f.backendURL, port: Number(new URL(f.url).port) }))
  const exec = (command: string) => run(process.execPath, [cli, command, '--data-dir', dir])
  await expect(exec('start')).rejects.toThrow()
  await expect(readFile(join(dir, 'gateway.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
  await writeFile(join(dir, 'gateway.lock'), '{"accidental-secret":"never-show-this"')
  await expect(exec('stop')).rejects.toThrow(/实例记录无效/)
  const record = await readFile(join(dir, 'gateway.lock'), 'utf8')
  expect(record).toContain('never-show-this')
  await expect(exec('doctor')).rejects.toMatchObject({ stdout: expect.stringContaining('"instance":"unverified"') })
  expect(await readFile(join(dir, 'gateway.lock'), 'utf8')).toBe(record)
})

it('runs init/start/doctor/stop/restart in native Node without installing desktop or models', async () => {
  const dir = await directory()
  const f = await fixture((request, response) => {
    if (request.url === '/api/user/login') {
      response.end('{"success":true,"data":{"access_token":"fixture-only","user":{"id":1,"role":100,"username":"fixture"}}}')
      return
    }
    expect(request.url).toBe('/api/status')
    response.end('{"success":true}')
  })
  const exec = (command: string) => run(process.execPath, [cli, command, '--data-dir', dir])
  await exec('init')
  await writeFile(join(dir, 'gateway.json'), JSON.stringify({ ...defaults, port: 0, consolePort: 0, backendURL: f.backendURL }))
  const children: ChildProcess[] = []
  onTestFinished(() => { for (const child of children) child.kill() })
  async function start() {
    const child = spawn(process.execPath, [cli, 'start', '--data-dir', dir], { stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    return new Promise<{ host: string, port: number, consoleURL: string, modelsStarted: boolean }>((resolve, reject) => {
      let output = ''
      let errors = ''
      const timeout = setTimeout(() => reject(new Error(`Gateway startup timed out: ${errors}`)), 3000)
      child.stderr!.on('data', (data) => { errors += data })
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Gateway exited ${code}: ${errors}`)) })
      child.stdout!.on('data', (data) => {
        output += data
        if (output.includes('\n')) {
          clearTimeout(timeout)
          resolve(JSON.parse(output.split('\n')[0]!))
        }
      })
    })
  }
  const ready = await start()
  expect(ready.modelsStarted).toBe(false)
  const address = `http://${ready.host}:${ready.port}`
  expect((await fetch(`${address}/api/token/`, { headers: auth })).status).toBe(404)
  await expect(exec('start')).rejects.toThrow()
  const instance = JSON.parse(await readFile(join(dir, 'gateway.lock'), 'utf8'))
  const rejected = await fetch(`http://127.0.0.1:${instance.controlPort}/stop`, { method: 'POST', headers: auth })
  expect(rejected.status).toBe(401)
  const doctor = JSON.parse((await exec('doctor')).stdout)
  expect(doctor).toMatchObject({ instance: 'running', backendReachable: true, modelsStarted: false, inferenceChecked: false })
  expect(doctor.node).toBe(process.versions.node)
  expect(f.seen.map(item => item.path)).toEqual(['/api/status'])
  expect(JSON.stringify(doctor)).not.toContain(instance.token)
  const login = await fetch(`${ready.consoleURL}manage/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"username":"fixture","password":"fixture"}' })
  const session = await login.json()
  const configBefore = await readFile(join(dir, 'gateway.json'), 'utf8')
  const refused = await fetch(`${ready.consoleURL}manage/deployment`, { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${session.token}` }, body: JSON.stringify({ access: 'local', host: '127.0.0.1', port: Number(new URL(f.url).port), publicURL: '' }) })
  expect(refused.status).toBe(400)
  expect(await readFile(join(dir, 'gateway.json'), 'utf8')).toBe(configBefore)
  expect((await fetch(`${address}/healthz`)).status).toBe(200)
  await exec('stop')
  await expect(readFile(join(dir, 'gateway.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fetch(`${address}/healthz`)).rejects.toThrow()
  expect((await start()).modelsStarted).toBe(false)
  await exec('stop')
  await expect(exec('stop')).rejects.toThrow()
}, 15_000)
