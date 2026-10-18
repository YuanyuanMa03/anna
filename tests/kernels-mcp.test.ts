import type { AnnaTool } from '../packages/kernels/types'
import { afterEach, expect, it } from 'vitest'
import { serveTools } from '../packages/kernels/external/mcp'

const memory: string[] = []
const tools: AnnaTool[] = [
  { name: 'anna_memory', label: '共同记忆', description: 'remember', parameters: { type: 'object', properties: { text: { type: 'string' } } }, execute: async (args) => {
    memory.push(String(args.text))
    return `已记住：${String(args.text)}`
  } },
  { name: 'anna_status', label: 'Anna 状态', description: 'status', parameters: { type: 'object', properties: {} }, execute: async () => {
    throw new Error('还没有连接')
  } },
]
let close: (() => Promise<void>) | undefined
afterEach(async () => close?.())

async function start() {
  const server = await serveTools(tools)
  close = server.close
  const post = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${server.token}` }) => fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) })
  return { server, post }
}
/** A tool call answers as an SSE stream; the JSON-RPC response is its `message` event. */
async function sse(response: Response) {
  const data = (await response.text()).split('\n').find(line => line.startsWith('data: '))!
  return JSON.parse(data.slice(6))
}

it('speaks MCP over Streamable HTTP: initialize, list, call (as SSE), errors as tool results', async () => {
  const { server, post } = await start()
  expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  const init = await (await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })).json()
  expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'anna' } })
  expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
  const list = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
  expect(list.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['anna_memory', 'anna_status'])
  expect(list.result.tools[0]).toMatchObject({ title: '共同记忆', inputSchema: { type: 'object' } })

  const called = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'anna_memory', arguments: { text: '喜欢绿茶' } } })
  expect(called.headers.get('content-type')).toBe('text/event-stream')
  expect(await sse(called)).toEqual({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: '已记住：喜欢绿茶' }] } })
  expect(memory).toEqual(['喜欢绿茶'])
  expect((await sse(await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'anna_status', arguments: {} } }))).result).toEqual({ content: [{ type: 'text', text: '还没有连接' }], isError: true })
  expect((await (await post({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'bash', arguments: {} } })).json()).error.code).toBe(-32602)
  expect((await (await post({ jsonrpc: '2.0', id: 6, method: 'resources/list' })).json()).error.code).toBe(-32601)
})

it('answers only the holder of its token, and never a browser', async () => {
  const { server, post } = await start()
  const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'anna_memory', arguments: { text: 'x' } } }
  expect((await post(call, {})).status).toBe(401)
  expect((await post(call, { authorization: 'Bearer wrong' })).status).toBe(401)
  expect((await post(call, { authorization: `Bearer ${server.token}`, origin: 'https://evil.example' })).status).toBe(401)
  expect((await fetch(server.url, { headers: { authorization: `Bearer ${server.token}` } })).status).toBe(405)
  expect(memory).not.toContain('x')
  const other = await serveTools(tools)
  expect(other.token).not.toBe(server.token)
  await other.close()
})

it('keeps a slow tool call alive: progress notifications when the client asked for them, SSE comments otherwise', async () => {
  const slow: AnnaTool = { name: 'anna_delegate', label: '派活', description: 'slow', parameters: { type: 'object' }, execute: () => new Promise(resolve => setTimeout(() => resolve('完成'), 120)) }
  const server = await serveTools([slow], { keepAlive: 20 })
  close = server.close
  const call = (meta?: object) => fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${server.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'anna_delegate', arguments: {}, ...(meta ? { _meta: meta } : {}) } }) }).then(response => response.text())
  const events = (await call({ progressToken: 'p1' })).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)))
  const progress = events.filter(event => event.method === 'notifications/progress')
  expect(progress.length).toBeGreaterThan(1)
  expect(progress.map(event => event.params.progressToken)).toEqual(progress.map(() => 'p1'))
  expect(progress.map(event => event.params.progress)).toEqual(progress.map((_, index) => index + 1))
  expect(events.at(-1)).toEqual({ jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text: '完成' }] } })
  const plain = await call()
  expect(plain).toContain(': keep-alive')
  expect(plain).not.toContain('notifications/progress')
})
