import { spawn } from 'node:child_process'
import { delimiter, dirname } from 'node:path'
import process from 'node:process'
import { unwrapCmdShim } from './windows-shim'

export interface AgentLocation { command: string, prefix?: string[] }
export class RpcError extends Error {
  constructor(message: string, readonly code?: number) { super(message) }
}

/** A bounded, local metadata connection. Never sends turn/start or executes a model request. */
export async function withCodex<T>(location: AgentLocation, cwd: string, work: (request: (method: string, params?: object) => Promise<any>) => Promise<T>): Promise<T> {
  const shim = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(location.command) ? unwrapCmdShim(location.command) : undefined
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(location.command) && !shim)
    throw new Error('无法安全启动这个 Codex 包装脚本，请使用原生可执行文件或 npm 安装')
  const child = spawn(shim?.command ?? location.command, [...(shim?.prefix ?? []), ...(location.prefix ?? []), 'app-server'], { cwd, windowsHide: true, env: { ...process.env, PATH: [dirname(location.command), process.env.PATH].filter(Boolean).join(delimiter), NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
  let id = 0
  let buffer = ''
  const pending = new Map<number, { resolve: (value: any) => void, reject: (error: Error) => void, timeout: ReturnType<typeof setTimeout> }>()
  const fail = (error: Error) => {
    for (const item of pending.values()) { clearTimeout(item.timeout); item.reject(error) }
    pending.clear()
  }
  child.on('error', fail)
  child.stdin.on('error', fail)
  child.on('exit', () => fail(new Error('Codex 元数据进程已结束')))
  child.stderr.resume()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    if (buffer.length > 8 * 1024 * 1024) { fail(new Error('Codex 元数据响应过大')); child.kill(); return }
    for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      let reply: any
      try { reply = JSON.parse(line) }
      catch { continue }
      const item = pending.get(reply.id)
      if (!item)
        continue
      clearTimeout(item.timeout)
      pending.delete(reply.id)
      if (reply.error)
        item.reject(new RpcError(reply.error.message ?? 'Codex 不支持这个操作', reply.error.code))
      else item.resolve(reply.result)
    }
  })
  const request = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
    const next = ++id
    const timeout = setTimeout(() => { pending.delete(next); reject(new Error('Codex 元数据查询超时')) }, 15000)
    pending.set(next, { resolve, reject, timeout })
    child.stdin.write(`${JSON.stringify({ id: next, method, params })}\n`, (error) => {
      if (error) { clearTimeout(timeout); pending.delete(next); reject(error) }
    })
  })
  try {
    await request('initialize', { clientInfo: { name: 'anna', title: 'Anna', version: '0.6.0' }, capabilities: {} })
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`)
    return await work(request)
  }
  finally {
    fail(new Error('元数据连接已关闭'))
    child.stdin.end()
    child.kill()
    const force = setTimeout(() => {
      if (child.exitCode === null)
        child.kill('SIGKILL')
    }, 500)
    force.unref()
  }
}
