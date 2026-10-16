import { describe, expect, it } from 'vitest'
import { EventAdapter } from '../packages/dsh-client/events'

// Synthetic protocol fixtures validate the adapter. They are not model or field observations.
describe('dSH event adapter', () => {
  it('correlates a tool result through its call id and exposes only product events', () => {
    const adapter = new EventAdapter()
    const call = adapter.adapt({ method: 'session.event', params: { event: { type: 'tool/call', seq: 1, time: 1, data: { turn: 1, step: 1, callId: 'synthetic-call', name: 'anna_status', arguments: '{}' } } } })
    expect(call).toEqual({ type: 'tool', phase: 'call', name: 'anna_status', text: '正在调用' })
    const result = adapter.adapt({ method: 'session.event', params: { event: { type: 'tool/result', seq: 2, time: 2, data: { turn: 1, step: 1, message: { role: 'tool', id: 'synthetic-message', source: { kind: 'tool', callId: 'synthetic-call' }, toolCallId: 'synthetic-call', content: [{ type: 'text', text: '{"characterId":"mark"}' }] } } } } })
    expect(result).toEqual({ type: 'tool', phase: 'result', name: 'anna_status', text: '{"characterId":"mark"}' })
    expect(adapter.adapt({ method: 'unrelated', params: {} })).toBeUndefined()
  })
})
