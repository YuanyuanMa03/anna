import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

export function dataDirectory(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === 'win32')
    return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Anna', 'Gateway')
  if (platform === 'darwin')
    return join(home, 'Library', 'Application Support', 'Anna', 'Gateway')
  return join(env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home, '.local', 'share'), 'anna', 'gateway')
}

export const defaults = {
  version: 1,
  access: 'local',
  host: '127.0.0.1',
  port: 17864,
  backendURL: 'http://127.0.0.1:17860',
  consolePort: 17865,
  publicURL: '',
  allowLocalLLM: false,
}

export function privateHost(host) {
  const value = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (value === 'localhost' || value === '::1')
    return true
  if (isIP(value) === 6)
    return /^(?:f[cd]|fe[89ab])/i.test(value)
  if (isIP(value) !== 4)
    return false
  const [a, b] = value.split('.').map(Number)
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

export function validateConfig(value) {
  if (!value || value.version !== 1 || !['local', 'network'].includes(value.access))
    throw new Error('网关配置版本或连接模式无效。')
  // Bind an explicit IPv4/IPv6 address; do not resolve an arbitrary name for the listener.
  if (typeof value.host !== 'string' || !isIP(value.host))
    throw new Error('监听地址必须是明确的 IP 地址。')
  if (value.access === 'local' && !['127.0.0.1', '::1'].includes(value.host))
    throw new Error('对外监听须明确设置 access 为 network。')
  if (!Number.isInteger(value.port) || value.port < 0 || value.port > 65535)
    throw new Error('监听端口无效。')
  const consolePort = value.consolePort ?? 17865
  if (!Number.isInteger(consolePort) || consolePort < 0 || consolePort > 65535 || (consolePort !== 0 && consolePort === value.port))
    throw new Error('工作台端口无效或与数据端口冲突。')
  let publicURL = ''
  if (value.publicURL) {
    let address
    try { address = new URL(value.publicURL) }
    catch { throw new Error('对外地址无效。') }
    if (!['https:', 'http:'].includes(address.protocol) || address.username || address.password || address.search || address.hash || !['/', '/v1', '/v1/'].includes(address.pathname))
      throw new Error('对外地址须为不含凭据的 HTTP(S) 入口。')
    if (address.protocol === 'http:' && !privateHost(address.hostname))
      throw new Error('公共入口须使用 HTTPS；HTTP 仅限本机或可信私网。')
    publicURL = `${address.origin}${address.pathname.replace(/\/$/, '')}`
  }
  let url
  try { url = new URL(value.backendURL) }
  catch { throw new Error('后端地址无效。') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('后端须为无凭据、无路径的 HTTP(S) 地址。')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol === 'http:' && !privateHost(url.hostname))
    throw new Error('公共后端须使用 HTTPS；HTTP 仅限本机或可信私网。')
  if (local && Number(url.port || (url.protocol === 'https:' ? 443 : 80)) === value.port)
    throw new Error('网关不能将请求转发给自己。')
  return { version: 1, access: value.access, host: value.host, port: value.port, backendURL: url.origin, consolePort, publicURL, allowLocalLLM: value.allowLocalLLM === true }
}

export async function initialize(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  // Never overwrite an existing deployment or import the user's old gateway state implicitly.
  await writeFile(join(directory, 'gateway.json'), `${JSON.stringify(defaults, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}

export async function loadConfig(directory) {
  const source = await readFile(join(resolve(directory), 'gateway.json'), 'utf8')
  let value
  try { value = JSON.parse(source) }
  catch { throw new Error('gateway.json 不是有效 JSON；未输出配置内容。') }
  return validateConfig(value)
}
