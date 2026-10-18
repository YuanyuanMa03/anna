import type { Decoder } from '../packages/agents/adapters/types'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { claudeDecoder } from '../packages/agents/adapters/claude'

/** Feed a recorded real session (tests/fixtures/agents, recorded by scripts/record-agent.mjs) through a decoder. */
function replay(decoder: Decoder, fixture: string) {
  const lines = readFileSync(`tests/fixtures/agents/${fixture}`, 'utf8').split('\n').filter(line => line && !line.startsWith('>>>'))
  return lines.map(line => decoder.decode(line))
}

describe('claude decoder (stream-json + stdio permission prompts)', () => {
  it('normalizes tools, surfaces the permission request, and reports the session and final reply', () => {
    const decoded = replay(claudeDecoder(), 'claude-allow.jsonl')
    const events = decoded.flatMap(item => item.events)
    const starts = events.filter(event => event.type === 'tool-start')
    expect(starts.map(event => event.type === 'tool-start' && [event.name, event.input.path])).toEqual([['read', '/private/tmp/anna-claude-5xKm/note.txt'], ['write', '/private/tmp/anna-claude-5xKm/done.txt']])
    expect(events.filter(event => event.type === 'tool-end').every(event => event.type === 'tool-end' && !event.isError)).toBe(true)
    const approvals = decoded.flatMap(item => item.approval ? [item.approval] : [])
    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({ tool: 'write', input: { path: '/private/tmp/anna-claude-5xKm/done.txt', content: 'OK' } })
    const done = decoded.find(item => item.done)?.done
    expect(done).toMatchObject({ text: expect.stringContaining('done.txt'), isError: false })
    expect(decoded.find(item => item.sessionId)?.sessionId).toBe('295f675f-3d3a-41e8-92e8-e0bf3698dcb1')
  })

  it('answers a permission request in the control protocol', () => {
    const decoder = claudeDecoder()
    const request = readFileSync('tests/fixtures/agents/claude-allow.jsonl', 'utf8').split('\n').find(line => line.includes('"control_request"'))!
    const approval = decoder.decode(request).approval!
    expect(JSON.parse(decoder.answer(approval, { allow: true }))).toMatchObject({ type: 'control_response', response: { subtype: 'success', request_id: approval.id, response: { behavior: 'allow' } } })
    expect(JSON.parse(decoder.answer(approval, { allow: false, reason: '用户拒绝' })).response.response).toEqual({ behavior: 'deny', message: '用户拒绝' })
  })
})

describe('the companion\'s own tools over MCP keep their names at Anna\'s gate', () => {
  it('claude: mcp__anna__anna_* is normalized back to anna_*, other MCP tools are not', () => {
    const decoder = claudeDecoder()
    // Shape recorded from Claude Code 2.1 with Anna's tool server attached through --mcp-config.
    const asked = decoder.decode(JSON.stringify({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'mcp__anna__anna_memory', mcp_server: { name: 'anna', source: 'dynamic' }, input: { action: 'list' } } }))
    expect(asked.approval).toMatchObject({ tool: 'anna_memory', input: { action: 'list' } })
    const started = decoder.decode(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__anna__anna_delegate', input: { agent: 'codex', task: 'x' } }] } }))
    expect(started.events).toEqual([{ type: 'tool-start', id: 't1', name: 'anna_delegate', input: { agent: 'codex', task: 'x' } }])
    expect(decoder.decode(JSON.stringify({ type: 'control_request', request_id: 'r2', request: { subtype: 'can_use_tool', tool_name: 'mcp__other__anna_memory', input: {} } })).approval!.tool).toBe('claude:mcp__other__anna_memory')
  })

  it('codex: an mcpToolCall on the anna server becomes the anna_* tool with its result', async () => {
    const { codexDecoder } = await import('../packages/agents/adapters/codex')
    const decoder = codexDecoder()
    const item = { type: 'mcpToolCall', id: 'm1', server: 'anna', tool: 'anna_memory', arguments: { action: 'remember', text: '喜欢绿茶' }, status: 'inProgress' }
    expect(decoder.decode(JSON.stringify({ method: 'item/started', params: { item } })).events).toEqual([{ type: 'tool-start', id: 'm1', name: 'anna_memory', input: { action: 'remember', text: '喜欢绿茶' } }])
    const done = decoder.decode(JSON.stringify({ method: 'item/completed', params: { item: { ...item, status: 'completed', result: { content: [{ type: 'text', text: '已记住：喜欢绿茶' }] } } } }))
    expect(done.events).toEqual([{ type: 'tool-end', id: 'm1', name: 'anna_memory', output: '已记住：喜欢绿茶', isError: false }])
    const other = decoder.decode(JSON.stringify({ method: 'item/started', params: { item: { ...item, id: 'm2', server: 'github' } } }))
    expect(other.events[0]).toMatchObject({ name: 'codex:mcpToolCall' })
  })
})

describe('codex decoder (app-server JSON-RPC)', () => {
  it('turns items into tool events, unwraps the login shell, surfaces approvals and the thread id', async () => {
    const { codexDecoder } = await import('../packages/agents/adapters/codex')
    const decoded = replay(codexDecoder(), 'codex-allow.jsonl')
    const events = decoded.flatMap(item => item.events)
    expect(events.filter(event => event.type === 'tool-start').map(event => event.type === 'tool-start' && [event.name, event.input.command])).toEqual([['bash', 'cat note.txt'], ['bash', 'printf \'OK\' > done.txt']])
    expect(decoded.flatMap(item => item.approval ? [item.approval] : []).map(approval => [approval.tool, approval.input.command])).toEqual([['bash', 'cat note.txt'], ['bash', 'printf \'OK\' > done.txt']])
    expect(decoded.find(item => item.sessionId)?.sessionId).toBe('01a14751-e847-7970-b212-564d42f5b047')
    expect(decoded.find(item => item.done)?.done).toMatchObject({ text: expect.stringContaining('done.txt'), isError: false })
  })

  it('a failed turn reports why (shapes from codex 0.160: usage limit, provider 401)', async () => {
    const { codexDecoder } = await import('../packages/agents/adapters/codex')
    const limit = 'You’ve hit your usage limit. Try again at 4:25 PM.'
    const decoder = codexDecoder()
    decoder.decode(JSON.stringify({ method: 'error', params: { error: { message: limit, codexErrorInfo: 'usageLimitExceeded' }, willRetry: false } }))
    expect(decoder.decode(JSON.stringify({ method: 'turn/completed', params: { turn: { id: 't', status: 'failed', error: { message: limit } } } })).done).toEqual({ text: limit, isError: true })
    const other = codexDecoder()
    other.decode(JSON.stringify({ method: 'error', params: { error: { message: 'unexpected status 401 Unauthorized' }, willRetry: false } }))
    expect(other.decode(JSON.stringify({ method: 'turn/completed', params: { turn: { id: 't', status: 'failed' } } })).done).toEqual({ text: 'unexpected status 401 Unauthorized', isError: true })
  })

  it('reports declined commands as failed tools and answers approvals in JSON-RPC', async () => {
    const { codexDecoder } = await import('../packages/agents/adapters/codex')
    const decoder = codexDecoder()
    const decoded = replay(decoder, 'codex-deny.jsonl')
    expect(decoded.flatMap(item => item.events).some(event => event.type === 'tool-end' && event.isError)).toBe(true)
    const approval = decoded.find(item => item.approval)!.approval!
    expect(JSON.parse(decoder.answer(approval, { allow: true }))).toEqual({ id: approval.id, result: { decision: 'accept' } })
    expect(JSON.parse(decoder.answer(approval, { allow: false }))).toEqual({ id: approval.id, result: { decision: 'decline' } })
  })
})

describe('upfront-approval agents (synthetic streams from their published schemas)', () => {
  it.each([
    ['gemini', 'gemini-synthetic.jsonl', 'gem-session-1', [['read', '/w/note.txt'], ['bash', 'printf OK > done.txt']], 'the shell command was denied'],
    ['opencode', 'opencode-synthetic.jsonl', 'ses_oc1', [['read', '/w/note.txt'], ['bash', 'printf OK > done.txt']], 'write was rejected'],
    ['pi', 'pi-synthetic.jsonl', 'pi-session-1', [['read', 'note.txt']], 'Read note.txt.'],
  ] as const)('%s: tools, failures, session and final text', async (agent, fixture, session, tools, text) => {
    const { decoderFor } = await import('../packages/agents/adapters')
    const decoded = replay(decoderFor(agent), fixture)
    const events = decoded.flatMap(item => item.events)
    expect(events.filter(event => event.type === 'tool-start').map(event => event.type === 'tool-start' && [event.name, event.input.path ?? event.input.command])).toEqual(tools)
    if (tools.length > 1)
      expect(events.some(event => event.type === 'tool-end' && event.isError)).toBe(true)
    expect(decoded.find(item => item.sessionId)?.sessionId).toBe(session)
    expect(decoded.find(item => item.done)?.done?.text).toContain(text)
  })
})
