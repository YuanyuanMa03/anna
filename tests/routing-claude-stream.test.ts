import type { Json } from '../packages/routing/json'
import { describe, expect, it } from 'vitest'
import { chatStreamToAnthropic } from '../packages/routing/claude-chat-stream'

/** Chat SSE → Anthropic SSE. Cases ported from cc-switch's `streaming.rs` tests (MIT). */

async function* bytes(chunks: (string | Error)[], hang = false) {
  for (const chunk of chunks) {
    if (chunk instanceof Error)
      throw chunk
    yield new TextEncoder().encode(chunk)
  }
  if (hang)
    await new Promise(() => {})
}
async function raw(chunks: (string | Error)[]) {
  let out = ''
  for await (const event of chatStreamToAnthropic(bytes(chunks))) out += event
  return out
}
const parse = (output: string): Json[] => output.split('\n\n').map(block => block.split('\n').find(line => line.startsWith('data: '))).filter(Boolean).map(line => JSON.parse(line!.slice(6)))
const collect = async (chunks: (string | Error)[]) => parse(await raw(chunks))
const data = (value: Json) => `data: ${JSON.stringify(value)}\n\n`
const done = 'data: [DONE]\n\n'
const delta = (value: Json, extra: Json = {}, id = 'chatcmpl_1', model = 'gpt-4o') => data({ id, model, choices: [{ delta: value, ...extra }] })
const call = (index: number, fields: Json) => ({ tool_calls: [{ index, type: 'function', ...fields }] })
const of = (events: Json[], type: string) => events.filter(event => event.type === type)
const text = (events: Json[], kind: 'text_delta' | 'thinking_delta' | 'input_json_delta') => of(events, 'content_block_delta').filter(event => event.delta.type === kind).map(event => event.delta.text ?? event.delta.thinking ?? event.delta.partial_json).join('')
/** `start:index:type` and `stop:index`, in order. */
const boundaries = (events: Json[]) => events.filter(event => event.type === 'content_block_start' || event.type === 'content_block_stop').map(event => event.type === 'content_block_start' ? `start:${event.index}:${event.content_block.type}` : `stop:${event.index}`)

describe('text, reasoning and the message frame', () => {
  it('message_start, one block per kind, one message_delta with usage, one message_stop', async () => {
    const events = await collect([delta({ reasoning_content: 'Think. ' }), delta({ content: 'Hel' }), delta({ content: 'lo' }), delta({}, { finish_reason: 'stop' }), data({ id: 'chatcmpl_1', choices: [], usage: { prompt_tokens: 9, completion_tokens: 4 } }), done])
    expect(events[0]).toMatchObject({ type: 'message_start', message: { id: 'chatcmpl_1', role: 'assistant', model: 'gpt-4o', content: [] } })
    expect(boundaries(events)).toEqual(['start:0:thinking', 'stop:0', 'start:1:text', 'stop:1'])
    expect(text(events, 'thinking_delta')).toBe('Think. ')
    expect(text(events, 'text_delta')).toBe('Hello')
    expect(of(events, 'message_delta')).toEqual([{ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 9, output_tokens: 4 } }])
    expect(events.at(-1)).toEqual({ type: 'message_stop' })
  })

  it('an empty reasoning field next to content doesn\'t split the text', async () => {
    const events = await collect([delta({ content: '某个历史', reasoning_content: '' }), delta({ content: '？', reasoning_content: '' }), delta({}, { finish_reason: 'stop' }), done])
    expect(boundaries(events)).toEqual(['start:0:text', 'stop:0'])
    expect(text(events, 'text_delta')).toBe('某个历史？')
  })

  it('chinese split across network chunks stays intact', async () => {
    const full = `${delta({ content: '你好' })}${delta({}, { finish_reason: 'stop' })}${done}`
    const encoded = new TextEncoder().encode(full)
    const middle = encoded.indexOf(0xE5) + 1
    let out = ''
    async function* split() {
      yield encoded.slice(0, middle)
      yield encoded.slice(middle)
    }
    for await (const event of chatStreamToAnthropic(split())) out += event
    expect(text(parse(out), 'text_delta')).toBe('你好')
    expect(out).not.toContain('�')
  })

  it('inline think blocks: split across chunks, in one chunk, unclosed, in prose, with mismatched tags', async () => {
    const split = await collect([delta({ content: '<thi' }), delta({ content: 'nking>tool call</thin' }), delta({ content: 'king>\n日志很大。我先看当前配置。' }), delta({}, { finish_reason: 'stop' }), done])
    expect(text(split, 'thinking_delta')).toBe('tool call')
    expect(text(split, 'text_delta')).toBe('日志很大。我先看当前配置。')
    expect(of(split, 'content_block_start').map(event => event.content_block.type)).toEqual(['thinking', 'text'])
    const single = await collect([delta({ content: '<think>the ball costs 0.05</think>The ball is $0.05' }), delta({}, { finish_reason: 'stop' }), done])
    expect([text(single, 'thinking_delta'), text(single, 'text_delta')]).toEqual(['the ball costs 0.05', 'The ball is $0.05'])
    const unclosed = await collect([delta({ content: '<thinking>partial reasoning' }), delta({}, { finish_reason: 'stop' }), done])
    expect([text(unclosed, 'thinking_delta'), text(unclosed, 'text_delta')]).toEqual(['partial reasoning', ''])
    const prose = await collect([delta({ content: 'a <thinking> looks like ' }), delta({ content: 'a tag in prose' }), delta({}, { finish_reason: 'stop' }), done])
    expect([text(prose, 'thinking_delta'), text(prose, 'text_delta')]).toEqual(['', 'a <thinking> looks like a tag in prose'])
    const mismatched = await collect([delta({ content: '<think>checking</thinking>Done' }), delta({}, { finish_reason: 'stop' }), done])
    expect([text(mismatched, 'thinking_delta'), text(mismatched, 'text_delta')]).toEqual(['checking', 'Done'])
  })
})

describe('tool calls', () => {
  it('routed by index, arguments as input_json_delta, closed before the message ends', async () => {
    const events = await collect([delta(call(0, { id: 'call_0', function: { name: 'first_tool' } })), delta(call(1, { id: 'call_1', function: { name: 'second_tool' } })), delta(call(1, { function: { arguments: '{"b":2}' } })), delta(call(0, { function: { arguments: '{"a":1}' } })), delta({}, { finish_reason: 'tool_calls' }), done])
    expect(of(events, 'content_block_start').map(event => [event.index, event.content_block.id, event.content_block.name])).toEqual([[0, 'call_0', 'first_tool'], [1, 'call_1', 'second_tool']])
    const argsOf = (index: number) => of(events, 'content_block_delta').filter(event => event.index === index).map(event => event.delta.partial_json).join('')
    expect([argsOf(0), argsOf(1)]).toEqual(['{"a":1}', '{"b":2}'])
    expect(boundaries(events)).toEqual(['start:0:tool_use', 'start:1:tool_use', 'stop:0', 'stop:1'])
    expect(of(events, 'message_delta')[0].delta.stop_reason).toBe('tool_use')
  })

  it('a block opens only once id and name are known; arguments that came first follow it', async () => {
    const events = await collect([delta(call(0, { function: { arguments: '{"a":' } })), delta(call(0, { id: 'call_0', function: { name: 'first_tool' } })), delta(call(0, { function: { arguments: '1}' } })), delta({}, { finish_reason: 'tool_calls' }), done])
    expect(of(events, 'content_block_start')).toHaveLength(1)
    expect(of(events, 'content_block_start')[0].content_block).toMatchObject({ id: 'call_0', name: 'first_tool' })
    expect(of(events, 'content_block_delta').map(event => event.delta.partial_json)).toEqual(['{"a":', '1}'])
  })

  it('a call whose id or name never came still starts at the finish, with a stand-in', async () => {
    const events = await collect([delta(call(0, { function: { arguments: '{}' } })), delta({}, { finish_reason: 'tool_calls' }), done])
    expect(of(events, 'content_block_start')[0].content_block).toMatchObject({ type: 'tool_use', id: 'tool_call_0', name: 'unknown_tool' })
  })

  it('mixed line endings, whole or a character at a time', async () => {
    const input = `${delta(call(0, { id: 'call_0', function: { name: 'read_file', arguments: '{"path":' } }), {}, 'chatcmpl_mixed', 'test-model')}${data({ choices: [{ delta: call(0, { function: { arguments: '"README.md"}' } }) }] })}${data({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}${done}`
    for (const delimiter of ['\n\r\n', '\r\n\n']) {
      const text = input.replaceAll('\n\n', delimiter)
      for (const parts of [[text], [...text]]) {
        const events = await collect(parts)
        expect(of(events, 'content_block_start')[0].content_block).toMatchObject({ id: 'call_0', name: 'read_file' })
        expect(JSON.parse(of(events, 'content_block_delta').map(event => event.delta.partial_json).join(''))).toEqual({ path: 'README.md' })
        expect(of(events, 'message_delta')[0].delta.stop_reason).toBe('tool_use')
        expect(of(events, 'message_stop')).toHaveLength(1)
      }
    }
  })

  it('held-back text goes out and its block closes before a tool block opens', async () => {
    const cases: [string, 'text_delta' | 'thinking_delta', string, string][] = [['\n\n', 'text_delta', '\n\n', 'text'], ['<thi', 'text_delta', '<thi', 'text'], ['<thinking>plan</thin', 'thinking_delta', 'plan</thin', 'thinking']]
    for (const [content, kind, expected, type] of cases) {
      const events = await collect([delta({ content }, {}, 'tool', 'deepseek-v4.1-flash'), delta(call(0, { id: 'call_1', function: { name: 'Bash', arguments: '{}' } }), {}, 'tool'), delta({}, { finish_reason: 'tool_calls' }, 'tool'), done])
      expect(text(events, kind)).toBe(expected)
      expect(boundaries(events)).toEqual([`start:0:${type}`, 'stop:0', 'start:1:tool_use', 'stop:1'])
    }
  })

  it('a runaway of whitespace in the arguments cuts the call off', async () => {
    const events = await collect([delta(call(0, { id: 'call_ws', function: { name: 'Bash', arguments: '{"command":' } })), delta(call(0, { function: { arguments: ' '.repeat(600) } })), delta(call(0, { function: { arguments: '"ls"}' } })), delta({}, { finish_reason: 'tool_calls' }), done])
    expect(of(events, 'content_block_delta').map(event => event.delta.partial_json)).toEqual(['{"command":'])
    expect(of(events, 'message_stop')).toHaveLength(1)
  })
})

describe('usage and the end of the stream', () => {
  const toolTurn = delta(call(0, { id: 'tool-1', function: { name: 'Bash', arguments: '{"command":"pwd"}' } }), {}, 'chatcmpl_split', 'glm-5.1')
  const finish = delta({}, { finish_reason: 'tool_calls' }, 'chatcmpl_split', 'glm-5.1')
  const usage = (value: Json) => data({ choices: [], usage: value })

  it('a second finish reason (OpenRouter) doesn\'t make a second message_delta, it only completes the usage', async () => {
    const events = await collect([delta({}, { finish_reason: 'tool_calls' }, 'chatcmpl_dup'), data({ id: 'chatcmpl_dup', choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), done])
    expect(of(events, 'message_delta')).toHaveLength(1)
    expect(of(events, 'message_delta')[0].usage).toEqual({ input_tokens: 10, output_tokens: 5 })
    expect(of(events, 'message_stop')).toHaveLength(1)
  })

  it('usage after the finish reason lands in the one message_delta, cache reads and writes taken out of the input', async () => {
    const cached = await collect([toolTurn, finish, usage({ prompt_tokens: 13312, completion_tokens: 79, prompt_tokens_details: { cached_tokens: 100 } }), done])
    expect(of(cached, 'message_delta')).toEqual([{ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { input_tokens: 13212, output_tokens: 79, cache_read_input_tokens: 100 } }])
    expect(of(await collect([toolTurn, finish, usage({ prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 300 } }), done]), 'message_delta')[0].usage).toEqual({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 600, cache_creation_input_tokens: 300 })
    expect(of(await collect([toolTurn, finish, usage({ prompt_tokens: 6650, completion_tokens: 16, cache_read_input_tokens: 0, prompt_cache_hit_tokens: 6400 }), done]), 'message_delta')[0].usage).toEqual({ input_tokens: 250, output_tokens: 16, cache_read_input_tokens: 6400 })
    expect(of(await collect([toolTurn, finish, usage({ prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 80 }, cache_creation_input_tokens: 50 }), done]), 'message_delta')[0].usage.input_tokens).toBe(0)
    expect(of(await collect([toolTurn, finish, done]), 'message_delta')[0].usage).toEqual({ input_tokens: 0, output_tokens: 0 })
  })

  it('without [DONE]: finished if a finish reason came, otherwise no success events at all', async () => {
    const finished = await collect([delta({ content: 'hello' }), delta({}, { finish_reason: 'stop' })])
    expect(of(finished, 'message_delta')[0].delta.stop_reason).toBe('end_turn')
    expect(finished.at(-1)?.type).toBe('message_stop')
    const truncated = await collect([delta({ content: 'hello' })])
    expect(of(truncated, 'message_delta')).toEqual([])
    expect(of(truncated, 'message_stop')).toEqual([])
    expect(text(truncated, 'text_delta')).toBe('hello')
  })

  it('[DONE] without a finish reason still closes every open block, then stops', async () => {
    const text = await collect([delta({ reasoning_content: 'thinking hard' }, {}, 'chatcmpl_nofin', 'deepseek-v4.1-flash'), delta({ content: 'hello' }, {}, 'chatcmpl_nofin'), done])
    expect(boundaries(text)).toEqual(['start:0:thinking', 'stop:0', 'start:1:text', 'stop:1'])
    expect(text.at(-1)?.type).toBe('message_stop')
    const tool = await collect([delta(call(0, { id: 'call_0', function: { name: 'Bash', arguments: '{}' } })), done])
    expect(boundaries(tool)).toEqual(['start:0:tool_use', 'stop:0'])
    expect(tool.at(-1)?.type).toBe('message_stop')
  })

  it('content arriving after the finish reason reopens a block that [DONE] closes before the end', async () => {
    const events = await collect([delta({ reasoning_content: 'plan' }), delta({ content: 'main text' }), delta({}, { finish_reason: 'stop' }), delta({ content: ' trailing' }), done])
    expect(text(events, 'text_delta')).toBe('main text trailing')
    expect(boundaries(events)).toEqual(['start:0:thinking', 'stop:0', 'start:1:text', 'stop:1', 'start:2:text', 'stop:2'])
    const types = events.map(event => event.type)
    expect(types.lastIndexOf('content_block_stop')).toBeLessThan(types.indexOf('message_delta'))
  })

  it('a transport error or an upstream error event: what arrived, then an error, never success', async () => {
    const transport = await collect([delta({ content: 'partial' }), new Error('upstream disconnected')])
    expect(text(transport, 'text_delta')).toBe('partial')
    expect(transport.at(-1)).toMatchObject({ type: 'error', error: { type: 'api_error' } })
    expect(of(transport, 'message_stop')).toEqual([])
    for (const chunk of ['event: error\ndata: {"error":{"message":"slow down","type":"rate_limit_error"}}\n\n', data({ error: { message: 'quota exceeded', code: 'insufficient_quota' } })]) {
      const events = await collect([delta({ content: 'x' }), chunk, done])
      expect(events.at(-1)?.type).toBe('error')
      expect(of(events, 'message_stop')).toEqual([])
    }
    expect((await collect(['event: error\ndata: {"error":{"message":"slow down","type":"rate_limit_error"}}\n\n'])).at(-1)).toEqual({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } })
  })

  it('[DONE] is final: nothing after it changes the result, and it doesn\'t wait for the upstream to close', async () => {
    const prefix = `${delta({ content: 'visible' }, { finish_reason: 'stop' })}${data({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 11 } })}${done}`
    const expected = await raw([prefix])
    for (const tail of [new Error('late reset'), done, delta({ content: 'late' }), 'event: error\ndata: {"error":{"message":"late error"}}\n\n'])
      expect(await raw([prefix, tail])).toBe(expected)
    const reset = parse(await raw([delta({ content: 'visible' }, { finish_reason: 'stop' }), new Error('late reset')]))
    expect(of(reset, 'error')).toHaveLength(1)
    expect(of(reset, 'message_stop')).toEqual([])
    const events: string[] = []
    const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('waited for the upstream')), 1000))
    await Promise.race([(async () => {
      for await (const event of chatStreamToAnthropic(bytes([done], true))) events.push(event)
    })(), timer])
    expect(events.join('')).toContain('event: message_stop')
  })
})
