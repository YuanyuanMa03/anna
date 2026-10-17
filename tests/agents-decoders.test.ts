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
