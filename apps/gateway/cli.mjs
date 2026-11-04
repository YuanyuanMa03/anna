import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { BackendError } from '../../packages/gateway/backend.mjs'
import { dataDirectory, initialize, loadConfig, validateConfig } from '../../packages/gateway/config.mjs'
import { close, gatewayServer, json, listen } from '../../packages/gateway/server.mjs'
import { workbenchServer } from '../../packages/gateway/workbench.mjs'

const [command, ...args] = process.argv.slice(2)
const options = new Map()
let validArgs = args.length % 2 === 0
for (let i = 0; i < args.length; i += 2) {
  if (!['--data-dir', '--credentials'].includes(args[i]) || options.has(args[i]))
    validArgs = false
  options.set(args[i], args[i + 1])
}
if (options.has('--credentials') && command !== 'open')
  validArgs = false
const directory = resolve(options.get('--data-dir') || dataDirectory())
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

async function control(instance, path, body) {
  return fetch(`http://127.0.0.1:${instance.controlPort}${path}`, {
    method: ['/stop', '/console-open'].includes(path) ? 'POST' : 'GET',
    headers: { 'authorization': `Bearer ${instance.token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(path === '/console-open' ? 20_000 : 3000),
    redirect: 'error',
  })
}

async function start() {
  let config = await loadConfig(directory)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  let lock
  try { lock = await open(lockPath, 'wx', 0o600) }
  catch { throw new Error('无法独占数据目录。请运行 doctor 检查已有实例；异常退出留下的锁须核对后手动备份移走，不会自动杀进程。') }
  const token = randomBytes(32).toString('hex')
  const makeGateway = value => gatewayServer(value, entry => print({ event: 'request', ...entry }))
  let gateway = makeGateway(config)
  let port
  let consolePort
  let applying
  const dataAddress = () => {
    const host = config.host === '0.0.0.0' ? '127.0.0.1' : config.host === '::' ? '::1' : config.host
    return `http://${host.includes(':') ? `[${host}]` : host}:${port}/v1`
  }
  const workbench = workbenchServer({
    getConfig: () => config,
    getDataAddress: dataAddress,
    applyConfig: async (value) => {
      if (applying)
        throw new BackendError(409, '另一个连接变更正在进行。')
      const next = validateConfig(value)
      const previous = config
      const previousPort = port
      applying = (async () => {
        await writeFile(join(directory, 'gateway.previous.json'), JSON.stringify(previous, null, 2), { mode: 0o600 })
        await gateway.stop()
        const replacement = makeGateway(next)
        try {
          const bound = await listen(replacement.server, next.host, next.port)
          const temp = join(directory, 'gateway.json.pending')
          let created = false
          try {
            await writeFile(temp, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 })
            created = true
            await rename(temp, join(directory, 'gateway.json'))
          }
          catch (error) {
            if (created)
              await unlink(temp).catch(() => {})
            throw error
          }
          gateway = replacement; config = next; port = bound
        }
        catch {
          await replacement.stop()
          gateway = makeGateway(previous)
          port = await listen(gateway.server, previous.host, previousPort)
          throw new BackendError(400, '新地址或端口不可用，已恢复原监听；请修正后重试。')
        }
      })()
      try { await applying }
      finally { applying = undefined }
    },
  })
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
    else if (request.url === '/console-open' && request.method === 'POST') {
      void (async () => {
        const chunks = []
        let size = 0
        for await (const chunk of request) {
          size += chunk.length; if (size > 8192)
            throw new Error('Credentials too large'); chunks.push(chunk)
        }
        const source = Buffer.concat(chunks).toString()
        const body = source ? JSON.parse(source) : {}
        const code = body.username && body.password ? await workbench.bootstrap(body.username, body.password) : workbench.ownerCode()
        json(response, 200, { url: `http://127.0.0.1:${consolePort}/${code ? `#open=${code}` : ''}` })
      })().catch(() => json(response, 400, { error: '无法建立本机登录，请在工作台中登录。' }))
    }
    else { json(response, 404, { error: '接口不存在。' }) }
  })
  async function shutdown() {
    stopping ??= (async () => {
      await applying?.catch(() => {})
      await Promise.all([gateway.stop(), close(management), close(workbench.server)])
      await lock.close()
      await unlink(lockPath)
    })()
    return stopping
  }
  try {
    port = await listen(gateway.server, config.host, config.port)
    consolePort = await listen(workbench.server, '127.0.0.1', config.consolePort)
    const controlPort = await listen(management, '127.0.0.1', 0)
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt, controlPort, token }))
    process.once('SIGINT', () => void shutdown())
    process.once('SIGTERM', () => void shutdown())
    print({ event: 'ready', host: config.host, port, consoleURL: `http://127.0.0.1:${consolePort}/`, access: config.access, modelsStarted: false })
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
  else if (command === 'open') {
    let credentials
    if (options.has('--credentials')) {
      const value = JSON.parse(await readFile(resolve(options.get('--credentials')), 'utf8'))
      if (typeof value.admin_username !== 'string' || typeof value.admin_password !== 'string')
        throw new Error('凭据文件格式不支持。')
      credentials = { username: value.admin_username, password: value.admin_password }
    }
    const response = await control(await running(), '/console-open', credentials)
    const value = await response.json()
    if (!response.ok)
      throw new Error('本机登录链接未创建，请手动打开工作台登录。')
    const url = new URL(value.url)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
      throw new Error('工作台地址无法验证。')
    const [program, arguments_] = process.platform === 'darwin' ? ['/usr/bin/open', [url.href]] : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url.href]] : ['xdg-open', [url.href]]
    const child = spawn(program, arguments_, { stdio: 'ignore' })
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('系统浏览器未打开，请访问本机工作台地址。'))) })
    print({ opened: true, consoleURL: url.origin, modelsStarted: false })
  }
  else { throw new Error('用法：node apps/gateway/cli.mjs <init|start|stop|doctor|open> [--data-dir <目录>]') }
}
catch (error) {
  // Avoid dumping configuration, fetch internals, file contents or stack traces into shared logs.
  const message = error instanceof SyntaxError ? 'JSON 文件或响应格式无效；未输出其内容。' : error.code === 'EEXIST' ? '配置已存在，未覆盖。' : error.code === 'ENOENT' ? '配置或实例记录不存在，请先运行 init / start。' : error.message
  process.stderr.write(`Anna Gateway: ${message}\n`)
  process.exitCode = 1
}
