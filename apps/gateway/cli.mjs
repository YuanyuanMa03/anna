import { Buffer } from 'node:buffer'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { dataDirectory, initialize, loadConfig } from '../../packages/gateway/config.mjs'
import { close, gatewayServer, json, listen } from '../../packages/gateway/server.mjs'

const [command, ...args] = process.argv.slice(2)
const validArgs = args.length === 0 || (args.length === 2 && args[0] === '--data-dir')
const directory = resolve(args.length === 2 ? args[1] : dataDirectory())
const lockPath = join(directory, 'gateway.lock')
const print = value => process.stdout.write(`${JSON.stringify(value)}\n`)

async function running() {
  const source = await readFile(lockPath, 'utf8')
  let value
  try { value = JSON.parse(source) }
  catch { throw new Error('实例记录无效；请先检查数据目录，未输出记录内容。') }
  if (!Number.isInteger(value.controlPort) || value.controlPort < 1 || value.controlPort > 65535 || !/^[\da-f]{64}$/.test(value.token))
    throw new Error('实例记录无效；请先检查数据目录，不会按 PID 强制结束任何进程。')
  return value
}

async function control(instance, path) {
  return fetch(`http://127.0.0.1:${instance.controlPort}${path}`, {
    method: path === '/stop' ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${instance.token}` },
    signal: AbortSignal.timeout(3000),
    redirect: 'error',
  })
}

async function start() {
  const config = await loadConfig(directory)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  let lock
  try { lock = await open(lockPath, 'wx', 0o600) }
  catch { throw new Error('无法独占数据目录。请运行 doctor 检查已有实例；异常退出留下的锁须核对后手动备份移走，不会自动杀进程。') }
  const token = randomBytes(32).toString('hex')
  const gateway = gatewayServer(config, entry => print({ event: 'request', ...entry }))
  const startedAt = new Date().toISOString()
  let stopping
  const management = createServer((request, response) => {
    const supplied = Buffer.from(request.headers.authorization || '')
    const expected = Buffer.from(`Bearer ${token}`)
    if (request.headers.origin !== undefined || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      json(response, 401, { error: '需要本机控制凭据。' })
      return
    }
    if (request.url === '/status' && request.method === 'GET') {
      json(response, 200, { service: 'anna-gateway-control', pid: process.pid, startedAt })
    }
    else if (request.url === '/stop' && request.method === 'POST') {
      json(response, 200, { stopping: true })
      setImmediate(() => void shutdown())
    }
    else { json(response, 404, { error: '接口不存在。' }) }
  })
  async function shutdown() {
    stopping ??= (async () => {
      await Promise.all([gateway.stop(), close(management)])
      await lock.close()
      await unlink(lockPath)
    })()
    return stopping
  }
  try {
    const port = await listen(gateway.server, config.host, config.port)
    const controlPort = await listen(management, '127.0.0.1', 0)
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt, controlPort, token }))
    process.once('SIGINT', () => void shutdown())
    process.once('SIGTERM', () => void shutdown())
    print({ event: 'ready', host: config.host, port, access: config.access, modelsStarted: false })
  }
  catch (error) {
    await shutdown()
    throw error
  }
}

async function doctor() {
  const config = await loadConfig(directory)
  let instance = 'stopped'
  try {
    const owner = await running()
    const response = await control(owner, '/status')
    const value = await response.json()
    instance = response.ok && value.service === 'anna-gateway-control' && value.pid === owner.pid ? 'running' : 'unverified'
  }
  catch (error) {
    if (error.code !== 'ENOENT')
      instance = 'unverified'
  }
  let backendReachable = false
  try {
    // New API's status endpoint does not invoke any model. HTTP reachability is not inference acceptance.
    const response = await fetch(`${config.backendURL}/api/status`, { signal: AbortSignal.timeout(3000), redirect: 'error' })
    backendReachable = response.ok
    await response.body?.cancel()
  }
  catch {}
  print({ service: 'anna-gateway', platform: process.platform, arch: process.arch, node: process.versions.node, access: config.access, instance, backendReachable, inferenceChecked: false, modelsStarted: false, credentialStorage: 'backend-managed; transient control token in restricted lock file' })
  if (!backendReachable || instance === 'unverified')
    process.exitCode = 1
}

try {
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('Anna Gateway 需要 Node.js 24 或更高版本。')
  if (!validArgs)
    throw new Error('参数格式：<命令> [--data-dir <目录>]；路径有空格时请加引号。')
  if (command === 'init') {
    await initialize(directory)
    print({ initialized: true, directory, modelsStarted: false })
  }
  else if (command === 'start') { await start() }
  else if (command === 'stop') {
    const response = await control(await running(), '/stop')
    const result = await response.json()
    if (!response.ok || result.stopping !== true)
      throw new Error('无法验证本机网关，不会按 PID 强制结束进程。')
    // Wait for the owner to release the lock before reporting stop complete.
    for (let attempt = 0; attempt < 60; attempt++) {
      try { await readFile(lockPath) }
      catch (error) {
        if (error.code === 'ENOENT') { print({ stopped: true }); break }
        throw error
      }
      if (attempt === 59)
        throw new Error('网关停止未完成，请查看原启动窗口。')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  else if (command === 'doctor') { await doctor() }
  else { throw new Error('用法：node apps/gateway/cli.mjs <init|start|stop|doctor> [--data-dir <目录>]') }
}
catch (error) {
  // Avoid dumping configuration, fetch internals, file contents or stack traces into shared logs.
  const message = error.code === 'EEXIST' ? '配置已存在，未覆盖。' : error.code === 'ENOENT' ? '配置或实例记录不存在，请先运行 init / start。' : error.message
  process.stderr.write(`Anna Gateway: ${message}\n`)
  process.exitCode = 1
}
