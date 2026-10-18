/* eslint-disable antfu/no-top-level-await -- standalone fake agent process */
/* A stand-in for Claude Code / Codex that speaks their real headless protocols (see tests/fixtures/agents).
 * Usage: node fake-agent.mjs <claude|codex> [agent args...]
 * It asks permission to create done.txt in its cwd, writes it only when allowed, and supports resuming a session.
 * Given Anna's tool server (--mcp-config / -c mcp_servers.anna.*), a message starting with "记住：" makes it call
 * anna_memory over MCP instead, the way the real agents do.
 * Every invocation's argv and selected env are appended to $ANNA_FAKE_LOG as JSON lines. */
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'

const [agent, ...args] = process.argv.slice(2)
if (process.env.ANNA_FAKE_LOG)
  appendFileSync(process.env.ANNA_FAKE_LOG, `${JSON.stringify({ agent, args, cwd: process.cwd(), env: { ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL, ANNA_PROVIDER_KEY: process.env.ANNA_PROVIDER_KEY ? 'set' : undefined } })}\n`)
const out = message => process.stdout.write(`${JSON.stringify(message)}\n`)
const lines = createInterface({ input: process.stdin })
const next = () => new Promise(resolve => lines.once('line', line => resolve(JSON.parse(line))))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Call one of Anna's tools over Streamable HTTP MCP; the result arrives as an SSE `message` event. */
async function callAnna(server, name, args) {
  const response = await fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream', 'authorization': server.authorization }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
  const data = (await response.text()).split('\n').find(line => line.startsWith('data: '))
  return JSON.parse(data.slice(6)).result.content[0].text
}
function annaServer() {
  if (args.includes('--mcp-config')) {
    const server = JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers.anna
    return { url: server.url, authorization: server.headers.Authorization }
  }
  const value = key => args.find(arg => arg.startsWith(`mcp_servers.anna.${key}=`))?.slice(`mcp_servers.anna.${key}=`.length)
  return value('url') && { url: JSON.parse(value('url')), authorization: /"(.*)"/.exec(value('http_headers'))[1] }
}

if (agent === 'claude') {
  const resume = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : undefined
  const session = resume ?? 'fake-claude-session-1'
  const user = await next()
  const target = join(process.cwd(), 'done.txt')
  out({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd(), tools: ['Read', 'Write', 'Bash'] })
  out({ type: 'assistant', session_id: session, message: { content: [{ type: 'text', text: `收到：${user.message.content}` }] } })
  const remember = /记住：(.+)$/.exec(user.message.content)?.[1]
  const delegate = /交给 (\w+)：(.+)$/.exec(user.message.content)
  if ((remember || delegate) && annaServer()) {
    const [tool, input] = remember ? ['anna_memory', { action: 'remember', text: remember }] : ['anna_delegate', { agent: delegate[1], task: delegate[2] }]
    out({ type: 'assistant', session_id: session, message: { content: [{ type: 'tool_use', id: 'toolu_m', name: `mcp__anna__${tool}`, input }] } })
    out({ type: 'control_request', request_id: 'req-m', request: { subtype: 'can_use_tool', tool_name: `mcp__anna__${tool}`, mcp_server: { name: 'anna', source: 'dynamic' }, input } })
    const reply = await next()
    const result = reply.response?.response?.behavior === 'allow' ? await callAnna(annaServer(), tool, input) : 'denied'
    out({ type: 'user', session_id: session, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_m', content: [{ type: 'text', text: result }] }] } })
    out({ type: 'result', subtype: 'success', is_error: false, result, session_id: session })
    process.exit(0)
  }
  out({ type: 'assistant', session_id: session, message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Write', input: { file_path: target, content: 'OK' } }] } })
  await delay(Number(process.env.ANNA_FAKE_DELAY ?? 0))
  out({ type: 'control_request', request_id: 'req-1', request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: target, content: 'OK' }, tool_use_id: 'toolu_1' } })
  const reply = await next()
  const allowed = reply.response?.response?.behavior === 'allow'
  if (allowed)
    writeFileSync(target, 'OK')
  out({ type: 'user', session_id: session, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: allowed ? 'File created' : `denied: ${reply.response?.response?.message}`, is_error: !allowed }] } })
  const text = allowed ? `已创建 done.txt${resume ? '（续接了之前的会话）' : ''}。` : '写入被拒绝，没有创建文件。'
  out({ type: 'assistant', session_id: session, message: { content: [{ type: 'text', text }] } })
  out({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: session })
  process.exit(0)
}

if (agent === 'codex') {
  const target = join(process.cwd(), 'done.txt')
  let thread = 'fake-codex-thread-1'
  for await (const line of lines) {
    const message = JSON.parse(line)
    if (message.method === 'initialize') {
      out({ id: message.id, result: { userAgent: 'fake', platformOs: 'macos' } })
    }
    else if (message.method === 'thread/start' || message.method === 'thread/resume') {
      if (message.params?.threadId)
        thread = message.params.threadId
      out({ id: message.id, result: { thread: { id: thread } } })
    }
    else if (message.method === 'turn/start') {
      out({ id: message.id, result: { turn: { id: 'turn-1', status: 'inProgress' } } })
      const remember = /记住：(.+)$/.exec(message.params.input[0].text)?.[1]
      if (remember && annaServer()) {
        const item = { type: 'mcpToolCall', id: 'mcp-1', server: 'anna', tool: 'anna_memory', arguments: { action: 'remember', text: remember }, status: 'inProgress' }
        out({ method: 'item/started', params: { item } })
        const text = await callAnna(annaServer(), 'anna_memory', item.arguments)
        out({ method: 'item/completed', params: { item: { ...item, status: 'completed', result: { content: [{ type: 'text', text }] } } } })
        out({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'msg-1', text } } })
        out({ method: 'turn/completed', params: { threadId: thread, turn: { id: 'turn-1', status: 'completed' } } })
        continue
      }
      out({ method: 'item/started', params: { item: { type: 'commandExecution', id: 'exec-1', command: '/bin/zsh -lc "printf OK > done.txt"', cwd: process.cwd(), status: 'inProgress' } } })
      out({ id: 0, method: 'item/commandExecution/requestApproval', params: { kind: 'command', threadId: thread, turnId: 'turn-1', itemId: 'exec-1', command: '/bin/zsh -lc "printf OK > done.txt"', cwd: process.cwd() } })
    }
    else if (message.id === 0 && message.result) {
      const allowed = message.result.decision === 'accept'
      if (allowed)
        writeFileSync(target, 'OK')
      out({ method: 'item/completed', params: { item: { type: 'commandExecution', id: 'exec-1', command: '/bin/zsh -lc "printf OK > done.txt"', status: allowed ? 'completed' : 'declined', aggregatedOutput: '' } } })
      out({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'msg-1', text: allowed ? '用命令创建了 done.txt。' : '命令被拒绝。' } } })
      out({ method: 'turn/completed', params: { threadId: thread, turn: { id: 'turn-1', status: 'completed' } } })
    }
  }
  process.exit(0)
}
