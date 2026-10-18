import type { Json } from '../packages/routing/json'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { CodexToolContext, toolContextFrom } from '../packages/routing/codex-chat'
import { chatStreamToResponses, ChatToResponses } from '../packages/routing/codex-chat-stream'

/** Chat SSE → Responses SSE. Cases ported from cc-switch's `streaming_codex_chat.rs` tests (MIT). */

async function* bytes(chunks: (string | Error)[], hang = false) {
  for (const chunk of chunks) {
    if (chunk instanceof Error)
      throw chunk
    yield new TextEncoder().encode(chunk)
  }
  if (hang)
    await new Promise(() => {})
}
async function collect(chunks: (string | Error)[], context = new CodexToolContext()) {
  let out = ''
  for await (const event of chatStreamToResponses(bytes(chunks), context)) out += event
  return out
}
const parse = (output: string): Json[] => output.split('\n\n').map(block => block.split('\n').find(line => line.startsWith('data: '))).filter(Boolean).map(line => JSON.parse(line!.slice(6)))
const data = (value: Json) => `data: ${JSON.stringify(value)}\n\n`
const done = 'data: [DONE]\n\n'
const delta = (id: string, model: string, value: Json, extra: Json = {}) => data({ id, model, choices: [{ delta: value, ...extra }] })
const call = (index: number | undefined, fields: Json) => ({ tool_calls: [{ ...(index === undefined ? {} : { index }), type: 'function', ...fields }] })
const completedOf = (output: string) => parse(output).find(event => event.type === 'response.completed')

describe('text and reasoning', () => {
  it('text deltas, a completed response with usage (cache reads included)', async () => {
    const output = await collect([
      data({ id: 'chatcmpl_1', created: 123, model: 'gpt-5.4', choices: [{ delta: { content: 'Hel' } }] }),
      data({ id: 'chatcmpl_1', created: 123, model: 'gpt-5.4', choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6, prompt_tokens_details: { cached_tokens: 0 }, cache_read_input_tokens: 2 } }),
      done,
    ])
    for (const name of ['response.created', 'response.output_text.delta', 'response.completed'])
      expect(output).toContain(`event: ${name}`)
    expect(output).toContain('"text":"Hello"')
    expect(completedOf(output).response.usage).toMatchObject({ input_tokens: 4, input_tokens_details: { cached_tokens: 2 }, cache_read_input_tokens: 2 })
  })

  it('reasoning_content and reasoning become a reasoning item before the message', async () => {
    const output = await collect([
      delta('chatcmpl_reason', 'deepseek-reasoner', { reasoning_content: 'Need context. ' }),
      delta('chatcmpl_reason', 'deepseek-reasoner', { reasoning: 'Now answer. ' }),
      data({ id: 'chatcmpl_reason', model: 'deepseek-reasoner', choices: [{ delta: { content: 'Done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10, completion_tokens_details: { reasoning_tokens: 3 } } }),
      done,
    ])
    for (const name of ['response.reasoning_summary_part.added', 'response.reasoning_summary_text.delta', 'response.reasoning_summary_text.done'])
      expect(output).toContain(`event: ${name}`)
    expect(output).toContain('Need context. Now answer. ')
    expect(output).toContain('"reasoning_tokens":3')
    expect(output.indexOf('"type":"reasoning"')).toBeLessThan(output.indexOf('"type":"message"'))
  })

  it('an inline think block (either tag) becomes reasoning, tags never leak', async () => {
    const minimax = await collect([
      delta('chatcmpl_minimax', 'MiniMax-M2.7', { role: 'assistant', content: '<think>\nNeed' }),
      delta('chatcmpl_minimax', 'MiniMax-M2.7', { content: ' context.</think>\n\npong' }, { finish_reason: 'stop' }),
      data({ id: 'chatcmpl_minimax', model: 'MiniMax-M2.7', choices: [], usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10, completion_tokens_details: { reasoning_tokens: 3 } } }),
    ])
    expect(minimax).toContain('Need context.')
    expect(minimax).toContain('"text":"pong"')
    expect(minimax).toContain('"reasoning_tokens":3')
    expect(minimax).not.toContain('<think>')
    expect(minimax).not.toContain('</think>')
    expect(minimax).toContain('event: response.completed')
    const split = await collect([delta('chatcmpl_ds', 'deepseek-v4.1-flash', { content: '<thin' }), delta('chatcmpl_ds', 'deepseek-v4.1-flash', { content: 'king>tool call</thin' }), delta('chatcmpl_ds', 'deepseek-v4.1-flash', { content: 'king>\npong' }, { finish_reason: 'stop' }), done])
    const items = completedOf(split).response.output
    expect(items[0]).toMatchObject({ type: 'reasoning', summary: [{ text: 'tool call' }] })
    expect(items[1]).toMatchObject({ type: 'message', content: [{ text: 'pong' }] })
    expect(split).not.toContain('thinking>')
  })

  it('inline reasoning streams before its closing tag arrives', () => {
    const state = new ChatToResponses(new CodexToolContext())
    const chunk = (content: string) => ({ id: 'chatcmpl_long_think', model: 'MiniMax-M2.7', choices: [{ delta: { content } }] })
    state.chunk(chunk('<think>'))
    for (const step of ['step one', ' step two', ' step three']) {
      const last = parse(state.chunk(chunk(step)).join('')).at(-1)
      expect(last).toMatchObject({ type: 'response.reasoning_summary_text.delta', delta: step })
    }
    const output = [...state.chunk(chunk('</think>\n\npong')), ...state.finalize()].join('')
    const reasoningDone = parse(output).filter(event => event.type === 'response.output_item.done' && event.item.type === 'reasoning')
    expect(reasoningDone).toHaveLength(1)
    expect(reasoningDone[0].item.summary[0].text).toBe('step one step two step three')
    expect(output).toContain('"text":"pong"')
  })

  it('a text-only turn completes, usage details present from the start', async () => {
    const output = await collect([delta('chatcmpl_text', 'kimi-k3', { content: '完成了' }, { finish_reason: 'stop' }), done])
    expect(output).not.toContain('event: response.failed')
    for (const type of ['response.created', 'response.completed'])
      expect(parse(output).find(event => event.type === type).response.usage.input_tokens_details.cached_tokens).toBe(0)
  })
})

describe('tool calls', () => {
  it('argument deltas, then a done function call; Gemini\'s thought signature kept', async () => {
    const output = await collect([delta('chatcmpl_2', 'gpt-5.4', call(0, { id: 'call_1', function: { name: 'get_weather' } })), delta('chatcmpl_2', 'gpt-5.4', call(0, { function: { arguments: '{"city":"Tokyo"}' } }), { finish_reason: 'tool_calls' }), done])
    expect(output).toContain('event: response.function_call_arguments.delta')
    expect(output).toContain('event: response.function_call_arguments.done')
    expect(output).toContain('"call_id":"call_1"')
    const gemini = await collect([delta('chatcmpl_gemini', 'gemini-4-argon', { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'exec_command', arguments: '{"cmd":"ls"}' }, extra_content: { google: { thought_signature: 'sig-abc' } } }] }, { finish_reason: 'tool_calls' }), done])
    expect(parse(gemini).find(event => event.type === 'response.output_item.done' && event.item.type === 'function_call').item.extra_content.google.thought_signature).toBe('sig-abc')
    expect(completedOf(gemini).response.output[0].extra_content.google.thought_signature).toBe('sig-abc')
  })

  it('empty id and name in continuation deltas don\'t erase the call\'s identity', async () => {
    const output = await collect([delta('chatcmpl_dashscope', 'deepseek-v4-pro', call(0, { id: 'call_dashscope', function: { name: 'exec_command', arguments: '{' } })), delta('chatcmpl_dashscope', 'deepseek-v4-pro', call(0, { id: '', function: { name: '', arguments: '"cmd":"date"}' } }), { finish_reason: 'tool_calls' }), done])
    const events = parse(output)
    expect(events.filter(event => event.type === 'response.output_item.added')).toHaveLength(1)
    for (const item of [events.find(event => event.type === 'response.output_item.done').item, completedOf(output).response.output[0]])
      expect(item).toMatchObject({ type: 'function_call', name: 'exec_command', call_id: 'call_dashscope', arguments: '{"cmd":"date"}' })
    expect(output).not.toContain('"name":""')
    expect(output).not.toContain('"call_id":""')
  })

  it('parallel calls keep their order when the first one\'s name arrives late', async () => {
    const output = await collect([delta('p', 'deepseek-v4-pro', call(0, { id: 'call_first', function: { name: '', arguments: '{' } })), delta('p', 'deepseek-v4-pro', call(1, { id: 'call_second', function: { name: 'second_tool', arguments: '{"value":2}' } })), delta('p', 'deepseek-v4-pro', call(0, { function: { name: 'first_tool', arguments: '"value":1}' } }), { finish_reason: 'tool_calls' }), done])
    const added = parse(output).filter(event => event.type === 'response.output_item.added')
    expect(added.map(event => [event.output_index, event.item.name])).toEqual([[0, 'first_tool'], [1, 'second_tool']])
    expect(completedOf(output).response.output.map((item: Json) => [item.name, item.call_id, item.arguments])).toEqual([['first_tool', 'call_first', '{"value":1}'], ['second_tool', 'call_second', '{"value":2}']])
  })

  it('a nameless call is dropped; alone it fails the turn instead of ending it silently', async () => {
    const kept = await collect([delta('m', 'deepseek-v4-pro', call(0, { id: 'call_missing', function: { arguments: '{}' } })), delta('m', 'deepseek-v4-pro', call(1, { id: 'call_valid', function: { name: 'exec_command', arguments: '{"cmd":"date"}' } }), { finish_reason: 'tool_calls' }), done])
    expect(completedOf(kept).response.output).toEqual([expect.objectContaining({ name: 'exec_command', call_id: 'call_valid', arguments: '{"cmd":"date"}' })])
    expect(kept).not.toContain('call_missing')
    for (const name of [undefined, '   ']) {
      const alone = await collect([delta('d', 'kimi-k3', { content: '让我继续处理这个文件' }), delta('d', 'kimi-k3', call(0, { id: 'call_bad', function: { ...(name ? { name } : {}), arguments: '{}' } }), { finish_reason: 'tool_calls' }), done])
      expect(alone).toContain('event: response.failed')
      expect(alone).toContain('upstream_tool_call_dropped')
      expect(alone).not.toContain('event: response.completed')
    }
    const truncated = await collect([delta('t', 'kimi-k3', { content: '我来看看' }), delta('t', 'kimi-k3', call(0, { id: 'call_cut', function: { arguments: '{"pa' } }), { finish_reason: 'length' }), done])
    expect(truncated).toContain('event: response.completed')
    expect(truncated).toContain('"status":"incomplete"')
    expect(truncated).not.toContain('event: response.failed')
  })

  it('without an index: a new id is a new call; fragments and a repeated id stay in one; sparse indexes are fine', async () => {
    const separate = await collect([delta('n', 'deepseek-v4-pro', call(undefined, { id: 'call_a', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } })), delta('n', 'deepseek-v4-pro', call(undefined, { id: 'call_b', function: { name: 'exec_command', arguments: '{"cmd":"ls"}' } }), { finish_reason: 'tool_calls' }), done])
    expect(completedOf(separate).response.output.map((item: Json) => [item.call_id, item.name, item.arguments])).toEqual([['call_a', 'read_file', '{"path":"a.txt"}'], ['call_b', 'exec_command', '{"cmd":"ls"}']])
    for (const second of [{}, { id: 'call_a', function: { name: 'read_file' } }]) {
      const one = await collect([delta('f', 'deepseek-v4-pro', call(undefined, { id: 'call_a', function: { name: 'read_file', arguments: '{"path":' } })), delta('f', 'deepseek-v4-pro', call(undefined, { ...second, function: { ...(second as Json).function, arguments: '"a.txt"}' } }), { finish_reason: 'tool_calls' }), done])
      expect(completedOf(one).response.output).toEqual([expect.objectContaining({ call_id: 'call_a', arguments: '{"path":"a.txt"}' })])
    }
    const sparse = await collect([delta('s', 'deepseek-v4-pro', call(2, { id: 'call_sparse', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }), { finish_reason: 'tool_calls' }), done])
    expect(completedOf(sparse).response.output).toEqual([expect.objectContaining({ name: 'read_file', call_id: 'call_sparse', arguments: '{"path":"README.md"}' })])
  })

  it('custom tools stream as custom input; namespace and tool search come back as Codex sent them', async () => {
    const custom = await collect([delta('c', 'gpt-5.4', call(0, { id: 'call_custom', function: { name: 'exec' } })), delta('c', 'gpt-5.4', call(0, { function: { arguments: '{"input":' } })), delta('c', 'gpt-5.4', call(0, { function: { arguments: '"ls -la"}' } }), { finish_reason: 'tool_calls' }), done], toolContextFrom({ tools: [{ type: 'custom', name: 'exec' }] }))
    expect(custom).toContain('event: response.custom_tool_call_input.delta')
    expect(custom).toContain('event: response.custom_tool_call_input.done')
    expect(custom).not.toContain('event: response.function_call_arguments')
    for (const fragment of ['"id":"ctc_call_custom"', '"type":"custom_tool_call"', '"name":"exec"', '"input":"ls -la"'])
      expect(custom).toContain(fragment)
    const namespaced = await collect([delta('g', 'gpt-5.4', call(0, { id: 'call_gmail', function: { name: 'mcp__codex_apps__gmail___search_emails' } })), delta('g', 'gpt-5.4', call(0, { function: { arguments: '{"query":"in:inbox"}' } }), { finish_reason: 'tool_calls' }), done], toolContextFrom({ input: [{ type: 'tool_search_output', call_id: 'call_tool_search_1', tools: [{ type: 'namespace', name: 'mcp__codex_apps__gmail', tools: [{ type: 'function', name: '_search_emails', description: 'Search Gmail.', parameters: { type: 'object' } }] }] }] }))
    expect(completedOf(namespaced).response.output[0]).toMatchObject({ type: 'function_call', namespace: 'mcp__codex_apps__gmail', name: '_search_emails', arguments: '{"query":"in:inbox"}' })
    const search = await collect([delta('t', 'gpt-5.4', call(0, { id: 'call_tool_search_1', function: { name: 'tool_search' } })), delta('t', 'gpt-5.4', call(0, { function: { arguments: '{"query":"Gmail search emails","limit":10}' } }), { finish_reason: 'tool_calls' }), done], toolContextFrom({ tools: [{ type: 'tool_search' }], input: 'Search for Gmail tools.' }))
    expect(completedOf(search).response.output[0]).toMatchObject({ type: 'tool_search_call', execution: 'client', call_id: 'call_tool_search_1', arguments: { query: 'Gmail search emails' } })
  })

  it('arguments are canonical on done; reasoning (early or late) rides on the call', async () => {
    const args = await collect([delta('a', 'gpt-5.4', call(0, { id: 'call_1', function: { name: 'lookup' } })), delta('a', 'gpt-5.4', call(0, { function: { arguments: '{ "b": 2,' } })), delta('a', 'gpt-5.4', call(0, { function: { arguments: ' "a": 1 }' } }), { finish_reason: 'tool_calls' }), done])
    expect(args).toContain('"arguments":"{\\"a\\":1,\\"b\\":2}"')
    const early = await collect([delta('r', 'deepseek-v4-flash', { reasoning_content: 'Need file.' }), delta('r', 'deepseek-v4-flash', call(0, { id: 'call_1', function: { name: 'read_file' } })), delta('r', 'deepseek-v4-flash', call(0, { function: { arguments: '{"path":"README.md"}' } }), { finish_reason: 'tool_calls' }), done])
    const late = await collect([delta('l', 'deepseek-v4-flash', call(0, { id: 'call_1', function: { name: 'read_file' } })), delta('l', 'deepseek-v4-flash', call(0, { function: { arguments: '{"path":"README.md"}' } })), delta('l', 'deepseek-v4-flash', { reasoning_content: 'Need file.' }), delta('l', 'deepseek-v4-flash', {}, { finish_reason: 'tool_calls' }), done])
    for (const output of [early, late])
      expect(completedOf(output).response.output.find((item: Json) => item.type === 'function_call').reasoning_content).toBe('Need file.')
  })
})

describe('endings', () => {
  it('a transport error or an upstream error event fails the response, never completes it', async () => {
    const transport = await collect([new Error('boom')])
    expect(transport).toContain('event: response.failed')
    expect(transport).not.toContain('event: response.completed')
    const named = await collect(['event: error\ndata: {"error":{"message":"bad request","type":"invalid_request_error"}}\n\n', done])
    const dataOnly = await collect([data({ error: { message: 'quota exceeded', code: 'rate_limit_exceeded' } }), done])
    for (const [output, words] of [[named, ['bad request', 'invalid_request_error']], [dataOnly, ['quota exceeded', 'rate_limit_exceeded']]] as const) {
      expect(output).toContain('event: response.failed')
      for (const word of words) expect(output).toContain(word)
      expect(output).not.toContain('event: response.completed')
    }
  })

  it('a stream that just stops: incomplete if something arrived, failed if nothing did', async () => {
    const partial = await collect([delta('x', 'gpt-5.4', { content: 'partial' })])
    expect(partial).toContain('"status":"incomplete"')
    expect(partial).toContain('"incomplete_details":{"reason":"max_output_tokens"}')
    expect(partial).not.toContain('event: response.failed')
    const nothing = await collect([delta('x', 'gpt-5.4', {})])
    expect(nothing).toContain('event: response.failed')
    expect(nothing).toContain('stream_truncated')
  })

  it('[DONE] is final: nothing after it changes the result, and it doesn\'t wait for the upstream to close', async () => {
    for (const reason of ['stop', 'length']) {
      const prefix = `${delta('fixed', 'test', { content: 'visible' }, { finish_reason: reason })}${data({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 11 } })}${done}`
      const expected = await collect([prefix])
      expect(expected.match(/event: response\.completed\n/g)).toHaveLength(1)
      expect(expected).toContain('"output_tokens":11')
      for (const tail of [new Error('late reset'), done, data({ choices: [{ delta: { content: 'late' } }] }), 'event: error\ndata: {"error":{"message":"late error"}}\n\n']) {
        expect(await collect([prefix, tail])).toBe(expected)
        if (typeof tail === 'string')
          expect(await collect([prefix + tail])).toBe(expected)
      }
    }
    const reset = await collect([delta('fixed', 'test', { content: 'visible' }, { finish_reason: 'stop' }), new Error('late reset')])
    expect(reset.match(/event: response\.failed\n/g)).toHaveLength(1)
    expect(reset).not.toContain('event: response.completed\n')
    const events: string[] = []
    const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('waited for the upstream')), 1000))
    await Promise.race([(async () => {
      for await (const event of chatStreamToResponses(bytes([done], true), new CodexToolContext())) events.push(event)
    })(), timer])
    expect(events.join('')).toContain('event: response.completed')
  })
})

describe('compaction turns', () => {
  const compaction = () => toolContextFrom({ input: [{ type: 'message', role: 'user', content: 'hi' }, { type: 'compaction_trigger' }] })

  it('end with exactly one compaction item carrying the summary', async () => {
    const output = await collect([delta('c', 'kimi-k3', { reasoning_content: 'think' }), delta('c', 'kimi-k3', { content: 'Progress: done A.' }, { finish_reason: 'stop' }), done], compaction())
    const events = parse(output)
    const items = events.filter(event => event.type === 'response.output_item.done' && event.item.type === 'compaction').map(event => event.item)
    expect(items).toHaveLength(1)
    expect(Buffer.from(items[0].encrypted_content.replace('anna-compaction-v1:', ''), 'base64url').toString()).toBe('Progress: done A.')
    expect(events.at(-1)).toMatchObject({ type: 'response.completed', response: { status: 'completed' } })
  })

  it('a cut-off, filtered or empty summary is never kept', async () => {
    const truncated = await collect([data({ id: 'c', choices: [{ delta: { content: 'half' }, finish_reason: 'length' }] }), done], compaction())
    expect(truncated).toContain('event: response.incomplete')
    expect(truncated).not.toContain('"type":"compaction"')
    for (const reason of ['content_filter', 'sensitive']) {
      const filtered = parse(await collect([data({ id: 'c', choices: [{ delta: { content: 'Progress: half' }, finish_reason: reason }] }), done], compaction()))
      expect(filtered.at(-1)).toMatchObject({ type: 'response.incomplete', response: { incomplete_details: { reason: 'content_filter' } } })
    }
    const empty = await collect([data({ id: 'c', choices: [{ delta: { reasoning_content: 'only thinking' }, finish_reason: 'stop' }] }), done], compaction())
    expect(empty).toContain('compaction_summary_empty')
    expect(empty).not.toContain('event: response.completed')
    for (const prefix of [`${data({ id: 'fixed', choices: [{ delta: { content: 'summary' }, finish_reason: 'length' }] })}${done}`, `${data({ id: 'fixed', choices: [{ delta: {}, finish_reason: 'stop' }] })}${done}`])
      expect(await collect([prefix, new Error('late reset')], compaction())).toBe(await collect([prefix], compaction()))
  })
})
