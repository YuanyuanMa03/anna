/* eslint-disable no-cond-assign -- maintenance script */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import process from 'node:process'

/**
 * Record a real agent's headless stream for adapter tests (tests/fixtures/agents).
 * Usage: node scripts/record-agent.mjs claude <cwd> <out.jsonl> "<prompt>" [allow|deny]
 * Permission requests are answered with allow/deny so the approval round-trip is captured too.
 */
const [agent, cwd, out, prompt, decision = 'allow'] = process.argv.slice(2)
const lines = []

/** Fixtures are committed: strip the recorder's home path, account and environment details. */
function redact(line) {
  const prefix = line.startsWith('>>> ') ? '>>> ' : ''
  const message = JSON.parse(line.slice(prefix.length))
  if (message.type === 'system' && message.subtype === 'init')
    return `${prefix}${JSON.stringify({ type: 'system', subtype: 'init', session_id: message.session_id, model: message.model, cwd: message.cwd, tools: message.tools, permissionMode: message.permissionMode })}`
  if (/^account\/|rateLimits|remoteControl|mcpServer\/|app\/list|externalAgentConfig|skills\/changed/.test(message.method ?? '') || message.type === 'rate_limit_event')
    return undefined
  if (message.result?.userAgent)
    message.result = { userAgent: 'anna/redacted', platformOs: message.result.platformOs }
  return `${prefix}${JSON.stringify(message)}`.split(homedir()).join('/Users/user')
}
if (agent === 'codex') {
  // codex app-server: newline-delimited JSON-RPC over stdio (types: `codex app-server generate-ts`).
  const child = spawn('codex', ['app-server'], { cwd, stdio: ['pipe', 'pipe', 'inherit'] })
  let next = 1
  const send = (message) => { lines.push(`>>> ${JSON.stringify(message)}`); child.stdin.write(`${JSON.stringify(message)}\n`) }
  const request = (method, params) => send({ id: next++, method, params })
  let buffered = ''
  child.stdout.on('data', (chunk) => {
    buffered += chunk
    let index
    while ((index = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, index)
      buffered = buffered.slice(index + 1)
      if (!line.trim())
        continue
      lines.push(line)
      const message = JSON.parse(line)
      if (message.id === 1 && message.result) {
        send({ method: 'initialized' })
        request('thread/start', { cwd, approvalPolicy: 'untrusted', sandbox: 'workspace-write' })
      }
      else if (message.id === 2 && message.result) {
        request('turn/start', { threadId: message.result.thread.id, input: [{ type: 'text', text: prompt, text_elements: [] }] })
      }
      else if (message.method?.endsWith('requestApproval') && message.id !== undefined) {
        send({ id: message.id, result: { decision: decision === 'allow' ? 'accept' : 'decline' } })
      }
      else if (message.method === 'turn/completed') {
        child.stdin.end()
        setTimeout(() => child.kill(), 500)
      }
    }
  })
  request('initialize', { clientInfo: { name: 'anna', title: 'Anna', version: '0.4.0' }, capabilities: null })
  const timer = setTimeout(() => child.kill(), 150000)
  child.on('exit', (code) => {
    clearTimeout(timer)
    writeFileSync(out, `${lines.map(redact).filter(Boolean).join('\n')}\n`)
    console.log(`exit ${code}, ${lines.length} lines → ${out}`)
  })
}
else {
  const child = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--permission-mode', 'default'], { cwd, stdio: ['pipe', 'pipe', 'inherit'] })
  let buffer = ''
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (!line.trim())
        continue
      lines.push(line)
      const message = JSON.parse(line)
      if (message.type === 'control_request' && message.request?.subtype === 'can_use_tool') {
        const response = decision === 'allow' ? { behavior: 'allow', updatedInput: message.request.input } : { behavior: 'deny', message: 'The user declined this action.' }
        const reply = { type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response } }
        lines.push(`>>> ${JSON.stringify(reply)}`)
        child.stdin.write(`${JSON.stringify(reply)}\n`)
      }
      if (message.type === 'result')
        child.stdin.end()
    }
  })
  child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } })}\n`)
  const timer = setTimeout(() => child.kill(), 150000)
  child.on('exit', (code) => {
    clearTimeout(timer)
    writeFileSync(out, `${lines.map(redact).filter(Boolean).join('\n')}\n`)
    console.log(`exit ${code}, ${lines.length} lines → ${out}`)
  })
}
