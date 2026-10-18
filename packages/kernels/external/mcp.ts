import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AnnaTool } from '../types'
import { Buffer } from 'node:buffer'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

/** The MCP server name the external brains see; their tool names become `mcp__anna__anna_memory` and the like. */
export const mcpServerName = 'anna'
const protocolVersion = '2025-06-18'

export interface ToolServer {
  url: string
  token: string
  close: () => Promise<void>
}

/**
 * Anna's own tools (memory, status, delegation) as a Streamable HTTP MCP server for an external brain. It listens on
 * 127.0.0.1 with a random bearer token per kernel, keeps no sessions, and answers tool calls as an SSE stream that
 * keeps reporting progress, so a delegation that runs for many minutes doesn't trip the client's idle timeouts
 * (Claude Code gives up on a tool that is silent for 300 s).
 */
export async function serveTools(tools: AnnaTool[], options: { keepAlive?: number } = {}): Promise<ToolServer> {
  const keepAlive = options.keepAlive ?? 15_000
  const token = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)
  const authorized = (request: IncomingMessage) => {
    const given = Buffer.from(request.headers.authorization ?? '')
    return given.length === expected.length && timingSafeEqual(given, expected)
  }
  const server = createServer((request, response) => {
    // Browsers send Origin; only local CLI clients may talk to this server.
    if (request.headers.origin || !authorized(request))
      return end(response, 401)
    if (request.method !== 'POST' || request.url !== '/mcp')
      return end(response, 405)
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
      if (body.length > 1024 * 1024)
        request.destroy()
    })
    request.on('end', () => {
      let message: { id?: number | string, method?: string, params?: Record<string, any> }
      try { message = JSON.parse(body) }
      catch { return reply(response, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) }
      if (Array.isArray(message) || message.id === undefined)
        return end(response, 202)
      void handle(tools, message, response, keepAlive)
    })
  })
  // Tool calls (a delegation, an approval card) can outlast Node's default request timeouts.
  server.requestTimeout = 0
  server.headersTimeout = 60_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

async function handle(tools: AnnaTool[], message: { id?: number | string, method?: string, params?: Record<string, any> }, response: ServerResponse, keepAlive: number) {
  const id = message.id!
  const result = (value: unknown) => reply(response, { jsonrpc: '2.0', id, result: value })
  switch (message.method) {
    case 'initialize':
      return result({ protocolVersion: message.params?.protocolVersion ?? protocolVersion, capabilities: { tools: {} }, serverInfo: { name: mcpServerName, title: 'Anna', version: '1' } })
    case 'ping':
      return result({})
    case 'tools/list':
      return result({ tools: tools.map(tool => ({ name: tool.name, title: tool.label, description: tool.description, inputSchema: tool.parameters })) })
    case 'tools/call': {
      const tool = tools.find(item => item.name === message.params?.name)
      if (!tool)
        return reply(response, { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${String(message.params?.name)}` } })
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      response.flushHeaders()
      // MCP progress notifications count as activity for the client; a bare SSE comment only keeps the socket open.
      const progressToken = message.params?._meta?.progressToken
      let progress = 0
      const timer = setInterval(() => response.write(progressToken === undefined ? ': keep-alive\n\n' : `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress: ++progress, message: 'working' } })}\n\n`), keepAlive)
      try {
        const text = await tool.execute((message.params?.arguments ?? {}) as Record<string, unknown>)
        response.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } })}\n\n`)
      }
      catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        response.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } })}\n\n`)
      }
      finally {
        clearInterval(timer)
        response.end()
      }
      return
    }
    default:
      return reply(response, { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${String(message.method)}` } })
  }
}

function reply(response: ServerResponse, payload: unknown) {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

function end(response: ServerResponse, status: number) {
  response.writeHead(status)
  response.end()
}
