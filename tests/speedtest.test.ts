import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { testEndpoints } from '../packages/agents/speedtest'
import { withPath } from '../packages/anna-host/agents-hub'

let fast: string
let slow: string
const servers: import('node:http').Server[] = []
async function serve(delay: number, status = 404) {
  const server = createServer((_request, response) => setTimeout(() => response.writeHead(status).end(), delay))
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
beforeAll(async () => {
  fast = await serve(5)
  slow = await serve(2600, 401)
})
afterAll(() => servers.forEach(server => server.close()))

it('times every endpoint in parallel; any HTTP status counts, timeouts and refusals are reported', async () => {
  const closed = await serve(0)
  servers.pop()!.close()
  const results = await testEndpoints([fast, slow, closed, 'not a url'], { timeoutMs: 2000 })
  expect(results[0]).toMatchObject({ url: fast, status: 404, latency: expect.any(Number) })
  expect(results[0]!.latency!).toBeLessThan(1000)
  expect(results[1]).toEqual({ url: slow, error: '请求超时' })
  expect(results[2]).toEqual({ url: closed, error: '连接失败' })
  expect(results[3]).toEqual({ url: 'not a url', error: '地址无效' })
}, 15000)

it('a candidate origin takes the in-use path; a candidate with its own path keeps it', () => {
  expect(withPath('https://cf.api.fan', 'https://www.packyapi.ai/v1')).toBe('https://cf.api.fan/v1')
  expect(withPath('https://api.moonshot.ai/v1', 'https://api.moonshot.cn/v1')).toBe('https://api.moonshot.ai/v1')
  expect(withPath('https://a.example/', undefined)).toBe('https://a.example')
})
