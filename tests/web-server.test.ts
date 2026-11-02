import type { ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/** Real HTTP/IPC wiring with a tiny core and a fake upstream, never an actual model call. */
describe.skipIf(process.getuid?.() === 0)('the web server limits', () => {
  let directory: string
  let child: ChildProcess
  let base: string
  let relay: string
  let log = ''
  let sessions: string

  async function freePort() {
    const socket = createServer()
    socket.listen(0, '127.0.0.1')
    await once(socket, 'listening')
    const port = (socket.address() as { port: number }).port
    await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()))
    return port
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'anna-web-http-'))
    await writeFile(join(directory, 'package.json'), '{"type":"module"}')
    await build({ entryPoints: ['apps/web/server.ts'], outfile: join(directory, 'web-server.js'), bundle: true, platform: 'node', format: 'esm' })
    await copyFile('tests/fixtures/web/core.mjs', join(directory, 'web-core.js'))
  })

  async function start(extraEnv: Record<string, string> = {}) {
    log = ''
    sessions = await mkdtemp(join(directory, 'sessions-'))
    const port = await freePort()
    const relayPort = await freePort()
    base = `http://127.0.0.1:${port}`
    relay = `http://127.0.0.1:${relayPort}/v1/chat/completions`
    await writeFile(join(directory, 'upstream.log'), '')
    await writeFile(join(directory, 'clock'), '0')
    await writeFile(join(directory, 'closed'), '')
    child = spawn(process.execPath, ['--import', pathToFileURL(resolve('tests/fixtures/web/upstream.mjs')).href, join(directory, 'web-server.js')], {
      env: { ...process.env, NODE_OPTIONS: '', PORT: String(port), ANNA_RELAY_PORT: String(relayPort), ANNA_MODEL_API_KEY: 'test-only', ANNA_ROOT: resolve('.'), ANNA_WEB_DATA: sessions, ANNA_MODEL: 'primary', ANNA_AGENT_MODEL: 'agent', ANNA_FALLBACK_MODELS: 'backup', ANNA_MAX_SESSIONS: '8', ANNA_MAX_SESSIONS_PER_CLIENT: '2', ANNA_PUBLIC_PROXIES: '0', ANNA_RELAY_PER_MINUTE: '100', ANNA_RELAY_PER_CLIENT_DAY: '3', ANNA_RELAY_PER_DAY: '4', ANNA_TEST_UPSTREAM_LOG: join(directory, 'upstream.log'), ANNA_TEST_CLOCK: join(directory, 'clock'), ANNA_TEST_CLOSED: join(directory, 'closed'), ANNA_SELF_TEST: '', ANNA_RELAY_DEBUG: '', ...extraEnv },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    child.stderr!.on('data', (chunk) => { log += chunk })
    for (let tries = 0; tries < 100; tries++) {
      try {
        if ((await fetch(`${base}/healthz`)).ok)
          return
      }
      catch {}
      if (child.exitCode !== null)
        throw new Error(log)
      await delay(20)
    }
    throw new Error(`Server never listened: ${log}`)
  }

  beforeEach(() => start())

  async function stop() {
    if (child && child.exitCode === null) {
      const exit = once(child, 'exit')
      child.kill('SIGTERM')
      await exit
    }
  }

  afterEach(() => stop())
  afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

  function open(ip: string, site?: string) {
    return fetch(`${base}/api/session`, { method: 'POST', headers: { 'X-Forwarded-For': ip, ...(site ? { 'Sec-Fetch-Site': site } : {}) } })
  }
  async function tokens() {
    return Promise.all((await readdir(sessions)).map(async dir => (await readFile(join(sessions, dir, 'relay-token'), 'utf8')).trim()))
  }
  function call(token: string, content = 'hi', raw?: string) {
    return fetch(relay, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify({ model: 'primary', messages: [{ role: 'user', content }] }) })
  }
  async function quota(ip: string) {
    return (await fetch(`${base}/api/quota`, { headers: { 'X-Forwarded-For': ip } })).json()
  }

  it('rejects other sites, shares slots between one client\'s tabs and leaves room for a neighbour', async () => {
    expect((await open('1.2.3.4', 'cross-site')).status).toBe(403)
    expect((await open('1.2.3.4', 'same-site')).status).toBe(403)
    expect((await open('1.2.3.4', 'same-origin')).status).toBe(200)
    expect((await open('1.2.3.4')).status).toBe(200)
    expect((await open('9.9.9.9, 1.2.3.4')).status).toBe(429)
    expect((await open('5.6.7.8')).status).toBe(200)
  })

  it('releases the reservation when startup fails', async () => {
    await writeFile(join(directory, 'web-core.js'), 'process.exit(1)')
    try {
      for (let i = 0; i < 3; i++) expect((await open('1.2.3.4')).status).toBe(500)
    }
    finally { await copyFile('tests/fixtures/web/core.mjs', join(directory, 'web-core.js')) }
    expect((await open('1.2.3.4')).status).toBe(200)
    expect((await open('1.2.3.4')).status).toBe(200)
    expect((await open('1.2.3.4')).status).toBe(429)
  })

  it('keeps a full half hour after the last tab closes, even after a long quiet visit', async () => {
    const { session } = await (await open('1.2.3.4')).json()
    const abort = new AbortController()
    const response = await fetch(`${base}/api/events`, { headers: { 'X-Anna-Session': session }, signal: abort.signal })
    const reader = response.body!.getReader()
    await reader.read()
    await writeFile(join(directory, 'clock'), String(31 * 60000))
    await delay(80)
    expect((await (await fetch(`${base}/healthz`)).json()).visitors).toBe(1)
    abort.abort()
    await reader.cancel().catch(() => {})
    await expect.poll(() => readFile(join(directory, 'closed'), 'utf8')).toBe('closed')
    await writeFile(join(directory, 'clock'), String(32 * 60000))
    await delay(80)
    expect((await (await fetch(`${base}/healthz`)).json()).visitors).toBe(1)
    await writeFile(join(directory, 'clock'), String(62 * 60000))
    for (let tries = 0; tries < 100; tries++) {
      if ((await (await fetch(`${base}/healthz`)).json()).visitors === 0)
        return
      await delay(20)
    }
    throw new Error('Idle session still holds a slot')
  })

  it('concurrent delayed bodies cannot bypass the session limit', async () => {
    await stop()
    await start({ ANNA_RELAY_PER_CLIENT_DAY: '100', ANNA_RELAY_PER_DAY: '100' })
    await open('1.2.3.4')
    const [token] = await tokens()
    const body = JSON.stringify({ model: 'primary', messages: [{ role: 'user', content: 'hi' }] })
    const pending = Array.from({ length: 31 }, () => {
      const outgoing = request(relay, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } })
      const result = new Promise<number>((resolve, reject) => {
        outgoing.on('response', (response) => { response.resume(); resolve(response.statusCode!) })
        outgoing.on('error', reject)
      })
      outgoing.write(body.slice(0, -1))
      return { outgoing, result }
    })
    // All headers and partial bodies arrive before any request can finish parsing.
    await delay(100)
    for (const { outgoing } of pending)
      outgoing.end(body.slice(-1))
    const statuses = await Promise.all(pending.map(item => item.result))
    expect(statuses.filter(status => status === 200)).toHaveLength(30)
    expect(statuses.filter(status => status === 429)).toHaveLength(1)
    expect((await readFile(join(directory, 'upstream.log'), 'utf8')).trim().split('\n')).toHaveLength(30)
  })

  it('counts actual fallback attempts, rejects invalid bodies without charging, and shares the client budget', async () => {
    await open('1.2.3.4')
    const [first] = await tokens()
    await open('1.2.3.4')
    const second = (await tokens()).find(token => token !== first)!
    expect((await call(first, '', '{')).status).toBe(502)
    expect((await call(first, 'fallback')).status).toBe(200)
    expect((await call(second)).status).toBe(200)
    expect((await call(first)).status).toBe(429)
    expect(await quota('1.2.3.4')).toEqual({ out: true })
    expect(await quota('5.6.7.8')).toEqual({ out: false })
    await open('5.6.7.8')
    const neighbour = (await tokens()).find(token => token !== first && token !== second)!
    expect((await call(neighbour)).status).toBe(200)
    expect((await call(neighbour)).status).toBe(429)
    expect(await quota('9.9.9.9')).toEqual({ out: true })
    expect((await readFile(join(directory, 'upstream.log'), 'utf8')).trim().split('\n')).toHaveLength(4)
  })
}, 20000)
