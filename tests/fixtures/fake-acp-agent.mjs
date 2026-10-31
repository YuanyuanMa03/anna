// A minimal Agent Client Protocol agent for tests: newline-delimited JSON-RPC 2.0 on stdin/stdout.
// Each prompt reports a thought, asks permission for one shell command (`ls -a`, or `touch acp.txt` when asked to
// touch), reports the result, then answers.
// A prompt containing "slow" waits for session/cancel; one containing "login" fails as an unauthenticated agent would.
import process from 'node:process'
import { createInterface } from 'node:readline'

let nextId = 100
const waiting = new Map()
let cancelled
const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
const update = (sessionId, body) => send({ method: 'session/update', params: { sessionId, update: body } })
function request(method, params) {
  const id = nextId++
  send({ id, method, params })
  return new Promise(resolve => waiting.set(id, resolve))
}

async function prompt(id, { sessionId, prompt: blocks }) {
  const text = blocks.map(block => block.text ?? '').join('')
  if (text.includes('login'))
    return send({ id, error: { code: -32000, message: 'Authentication required' } })
  update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } })
  if (text.includes('slow')) {
    await new Promise((resolve) => { cancelled = resolve })
    return send({ id, result: { stopReason: 'cancelled' } })
  }
  const command = text.includes('touch') ? 'touch acp.txt' : 'ls -a'
  update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 't1', title: command, kind: 'execute', status: 'pending', rawInput: { command } })
  const answer = await request('session/request_permission', {
    sessionId,
    toolCall: { toolCallId: 't1', title: command, kind: 'execute', rawInput: { command } },
    options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'always', name: 'Always', kind: 'allow_always' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }],
  })
  const allowed = answer.outcome?.outcome === 'selected' && answer.outcome.optionId === 'yes'
  update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: allowed ? 'completed' : 'failed', content: [{ type: 'content', content: { type: 'text', text: allowed ? 'notes.md' : 'rejected' } }] })
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${allowed ? 'ran' : 'skipped'} ` } })
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `for: ${text}` } })
  send({ id, result: { stopReason: 'end_turn' } })
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id !== undefined && !message.method) {
    waiting.get(message.id)?.(message.result ?? {})
    waiting.delete(message.id)
    return
  }
  if (message.method === 'initialize')
    send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false, mcpCapabilities: { http: true } }, authMethods: [] } })
  else if (message.method === 'session/new')
    send({ id: message.id, result: { sessionId: `s-${message.params.mcpServers.map(server => server.name).join(',') || 'none'}` } })
  else if (message.method === 'session/prompt')
    void prompt(message.id, message.params)
  else if (message.method === 'session/cancel')
    cancelled?.()
})
