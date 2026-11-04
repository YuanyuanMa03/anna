import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDirectory } from './config.mjs'

/** Main reads the OS owner's transient control reference, never provider/account credentials. */
export async function workbenchURL(directory = dataDirectory()): Promise<string> {
  const record = JSON.parse(await readFile(join(directory, 'gateway.lock'), 'utf8'))
  if (!Number.isInteger(record.controlPort) || record.controlPort < 1 || record.controlPort > 65535 || typeof record.token !== 'string' || !/^[a-f\d]{64}$/.test(record.token))
    throw new Error('本机网关记录无法验证。')
  const response = await fetch(`http://127.0.0.1:${record.controlPort}/console-open`, {
    method: 'POST',
    headers: { authorization: `Bearer ${record.token}` },
    signal: AbortSignal.timeout(3000),
    redirect: 'error',
  })
  if (!response.ok)
    throw new Error('本机工作台连接失败。')
  const result = await response.json() as { url?: string }
  const url = new URL(result.url || '')
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || (url.hash && !/^#open=[a-f\d]{64}$/.test(url.hash)))
    throw new Error('本机工作台地址无法验证。')
  return url.href
}
