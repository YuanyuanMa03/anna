import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { workbenchURL } from '../packages/gateway/desktop'

it('uses only the OS owner control reference and accepts a verified one-use loopback link', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anna gateway 主机-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const token = 'a'.repeat(64)
  const code = 'b'.repeat(64)
  let target = `http://127.0.0.1:17865/#open=${code}`
  const server = createServer((request, response) => {
    expect(request.url).toBe('/console-open')
    expect(request.method).toBe('POST')
    expect(request.headers.authorization).toBe(`Bearer ${token}`)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ url: target }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() }))
  const address = server.address() as AddressInfo
  await writeFile(join(directory, 'gateway.lock'), JSON.stringify({ controlPort: address.port, token }))
  expect(await workbenchURL(directory)).toBe(target)
  for (const unsafe of ['https://evil.invalid/', 'http://localhost:17865/', 'http://user:secret@127.0.0.1:17865/', 'http://127.0.0.1:17865/not-console', 'http://127.0.0.1:17865/?key=secret', 'http://127.0.0.1:17865/#open=bad']) {
    target = unsafe
    await expect(workbenchURL(directory)).rejects.toThrow('本机工作台地址无法验证。')
  }
  await writeFile(join(directory, 'gateway.lock'), JSON.stringify({ controlPort: address.port, token: 'invalid' }))
  await expect(workbenchURL(directory)).rejects.toThrow('本机网关记录无法验证。')
})
