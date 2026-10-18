import type { Json } from '../packages/routing/json'
import { describe, expect, it } from 'vitest'
import { anthropicToChat, chatToAnthropic, cleanSchema, resolveReasoningEffort, stripBillingHeader, wantsReasoningReplay } from '../packages/routing/claude-chat'
import { canonicalJson } from '../packages/routing/json'
import { mediaMovedMarker } from '../packages/routing/tool-media'

/** Anthropic Messages ↔ Chat Completions. Cases ported from cc-switch's `transform.rs` tests (MIT). */

const user = (content: Json) => ({ role: 'user', content })
const convert = (body: Json, replay = false) => anthropicToChat({ model: 'claude-3-opus', max_tokens: 1024, ...body }, replay)
const billing = 'x-anthropic-billing-header: cc_version=2.1.119.47e; cc_entrypoint=sdk-cli; cch=a7754;'

describe('system prompt', () => {
  it('a string or blocks become one system message first; cache_control never leaks', () => {
    expect(convert({ system: 'You are a helpful assistant.', messages: [user('Hello')] }).messages).toEqual([{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: 'Hello' }])
    const merged = convert({ system: [{ type: 'text', text: 'You are Claude Code.', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'Be concise.', cache_control: { type: 'ephemeral', ttl: '5m' } }], messages: [user('Hello')] })
    expect(merged.messages).toEqual([{ role: 'system', content: 'You are Claude Code.\nBe concise.' }, { role: 'user', content: 'Hello' }])
  })

  it('a leading billing header goes (it changes every request and breaks prompt caches); the same text later stays', () => {
    expect(convert({ system: `${billing}\n\nYou are a helpful assistant.`, messages: [user('Hello')] }).messages[0].content).toBe('You are a helpful assistant.')
    expect(convert({ system: [{ type: 'text', text: `${billing}\n` }, { type: 'text', text: 'Stable prompt' }], messages: [user('Hello')] }).messages[0].content).toBe('Stable prompt')
    expect(convert({ system: [{ type: 'text', text: `${billing}\n\nStable prompt part 1` }, { type: 'text', text: 'Stable prompt part 2' }], messages: [user('Hello')] }).messages[0].content).toBe('Stable prompt part 1\nStable prompt part 2')
    expect(convert({ system: 'Keep this literal:\nx-anthropic-billing-header: example', messages: [user('Hello')] }).messages[0].content).toBe('Keep this literal:\nx-anthropic-billing-header: example')
    expect(stripBillingHeader(billing)).toBe('')
    expect(stripBillingHeader(`${billing}\r\n\r\nrest`)).toBe('rest')
  })

  it('a system message mid-conversation stays where it is (moving it would break the cache prefix)', () => {
    const messages = convert({ system: 'You are Claude Code.', messages: [user('Hello'), { role: 'assistant', content: 'Hi there!' }, { role: 'system', content: '<total_tokens>14963538 tokens left</total_tokens>' }, user('Continue')] }).messages
    expect(messages).toHaveLength(5)
    expect(messages[3]).toEqual({ role: 'system', content: '<total_tokens>14963538 tokens left</total_tokens>' })
  })
})

describe('request fields and tools', () => {
  it('model, max tokens (o-series: max_completion_tokens), sampling, stop, stream pass through; no prompt_cache_key', () => {
    const result = convert({ model: 'gpt-4o', temperature: 0.2, top_p: 0.9, stop_sequences: ['END'], stream: true, messages: [user('Hello')] })
    expect(result).toMatchObject({ model: 'gpt-4o', max_tokens: 1024, temperature: 0.2, top_p: 0.9, stop: ['END'], stream: true })
    expect(result).not.toHaveProperty('prompt_cache_key')
    const o = convert({ model: 'o3-mini', messages: [user('Hello')] })
    expect(o.max_completion_tokens).toBe(1024)
    expect(o).not.toHaveProperty('max_tokens')
  })

  it('tools: functions with an object root schema, no null description, no BatchTool, no cache_control', () => {
    const result = convert({ messages: [user('hi')], tools: [{ name: 'get_weather', description: 'Get weather info', input_schema: { type: 'object', properties: { location: { type: 'string' } } }, cache_control: { type: 'ephemeral' } }, { name: 'NoDesc', input_schema: { properties: { a: { type: 'string', format: 'uri' } } } }, { name: 'do_work', input_schema: {} }, { type: 'web_search_20250305', name: 'web_search', max_uses: 8 }, { type: 'BatchTool', name: 'batch' }] })
    expect(result.tools).toEqual([
      { type: 'function', function: { name: 'get_weather', description: 'Get weather info', parameters: { type: 'object', properties: { location: { type: 'string' } } } } },
      { type: 'function', function: { name: 'NoDesc', parameters: { type: 'object', properties: { a: { type: 'string' } } } } },
      { type: 'function', function: { name: 'do_work', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'web_search', parameters: { type: 'object', properties: {} } } },
    ])
  })

  it('only the root schema is forced to an object', () => {
    expect(cleanSchema({ properties: { nullable_value: { anyOf: [{ type: 'string' }, { type: 'null' }] }, list: { items: { type: 'string' } } } })).toEqual({ type: 'object', properties: { nullable_value: { anyOf: [{ type: 'string' }, { type: 'null' }] }, list: { items: { type: 'string' } } } })
  })

  it('tool choice in Chat\'s words', () => {
    const choice = (value: Json) => convert({ messages: [user('hi')], tool_choice: value }).tool_choice
    expect(choice('any')).toBe('required')
    expect(choice('auto')).toBe('auto')
    expect(choice('none')).toBe('none')
    expect(choice({ type: 'any' })).toBe('required')
    expect(choice({ type: 'auto' })).toBe('auto')
    expect(choice({ type: 'none' })).toBe('none')
    expect(choice({ type: 'tool', name: 'Bash' })).toEqual({ type: 'function', function: { name: 'Bash' } })
  })
})

describe('messages', () => {
  it('tool use becomes tool_calls with canonical arguments; reasoning_content only for providers that want it', () => {
    const turn = { role: 'assistant', content: [{ type: 'thinking', thinking: 'I should call the tool.' }, { type: 'text', text: 'Let me check' }, { type: 'tool_use', id: 'call_123', name: 'get_weather', input: { b: 2, a: 1 } }] }
    const plain = convert({ model: 'gpt-5.4', messages: [turn] }).messages[0]
    expect(plain).toEqual({ role: 'assistant', content: 'Let me check', tool_calls: [{ id: 'call_123', type: 'function', function: { name: 'get_weather', arguments: '{"a":1,"b":2}' } }] })
    expect(convert({ model: 'deepseek-v4-flash', messages: [turn] }, true).messages[0].reasoning_content).toBe('I should call the tool.')
    const bare = { role: 'assistant', content: [{ type: 'tool_use', id: 'call_123', name: 'get_weather', input: {} }] }
    expect(convert({ messages: [bare] }, true).messages[0]).toMatchObject({ content: null, reasoning_content: 'tool call' })
    const redacted = { role: 'assistant', content: [{ type: 'redacted_thinking', data: 'opaque' }, ...bare.content] }
    expect(convert({ model: 'mimo-v2.5-pro', messages: [redacted] }, true).messages[0].reasoning_content).toBe('[redacted thinking]')
    expect(convert({ messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'No visible content yet.' }] }] }).messages).toEqual([])
  })

  it('which providers want reasoning back: DeepSeek and MiMo, by model or address (not Kimi)', () => {
    expect(wantsReasoningReplay('deepseek-v4-flash')).toBe(true)
    expect(wantsReasoningReplay('glm-5.3', 'https://api.xiaomimimo.com/v1')).toBe(true)
    expect(wantsReasoningReplay('kimi-k3', 'https://api.moonshot.cn/v1')).toBe(false)
  })

  it('tool results become tool messages; without media exactly as cc-switch sends them', () => {
    const raw = '{ "status": "ok", "count": 2 }'
    const messages = convert({ messages: [user([{ type: 'tool_result', tool_use_id: 'call_string', content: raw }, { type: 'tool_result', tool_use_id: 'call_array', content: [{ type: 'text', text: 'plain' }] }, { type: 'tool_result', tool_use_id: 'call_empty' }])] }).messages
    expect(messages).toEqual([{ role: 'tool', tool_call_id: 'call_string', content: raw }, { role: 'tool', tool_call_id: 'call_array', content: canonicalJson([{ type: 'text', text: 'plain' }]) }, { role: 'tool', tool_call_id: 'call_empty', content: '' }])
  })

  it('images in tool results move to one user message after the results; image blocks map to image_url', () => {
    const image = (data: string, type = 'image/png') => ({ type: 'image', source: { type: 'base64', media_type: type, data }, cache_control: { type: 'ephemeral' } })
    const one = convert({ messages: [user([{ type: 'tool_result', tool_use_id: 'call_image', content: [{ type: 'text', text: 'caption' }, image('SENTINEL')] }])] }).messages
    expect(one).toHaveLength(2)
    expect(one[0]).toMatchObject({ role: 'tool', tool_call_id: 'call_image' })
    expect(one[0].content).toContain(mediaMovedMarker)
    expect(one[0].content).not.toContain('SENTINEL')
    expect(one[1]).toEqual({ role: 'user', content: [{ type: 'text', text: '[anna: media output of tool call call_image]' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,SENTINEL' } }] })
    const parallel = convert({ messages: [user([{ type: 'tool_result', tool_use_id: 'call_1', content: [image('ONE')] }, { type: 'tool_result', tool_use_id: 'call_2', content: [image('TWO', 'image/jpeg')] }])] }).messages
    expect(parallel.map((message: Json) => message.role)).toEqual(['tool', 'tool', 'user'])
    expect(parallel[2].content).toHaveLength(4)
    const remote = convert({ messages: [user([{ type: 'image', source: { type: 'url', url: 'https://example.com/image.png' }, cache_control: { type: 'ephemeral' } }])] }).messages[0]
    expect(remote.content).toEqual([{ type: 'image_url', image_url: { url: 'https://example.com/image.png' } }])
  })

  it('cache_control on content is dropped, and a single text block becomes a plain string', () => {
    expect(convert({ messages: [user([{ type: 'text', text: 'Hello', cache_control: { type: 'ephemeral', ttl: '5m' } }])] }).messages[0]).toEqual({ role: 'user', content: 'Hello' })
  })
})

describe('reasoning effort (models that take reasoning_effort)', () => {
  const effort = (body: Json, model = 'gpt-5.4') => resolveReasoningEffort({ model, ...body })
  it('an explicit effort wins; max only where the model has it; thinking off drops it to low', () => {
    const on = { type: 'adaptive' }
    expect(effort({ output_config: { effort: 'low' }, thinking: on })).toBe('low')
    expect(effort({ output_config: { effort: 'medium' }, thinking: on })).toBe('medium')
    expect(effort({ output_config: { effort: 'high' }, thinking: on })).toBe('high')
    expect(effort({ output_config: { effort: 'xhigh' }, thinking: on })).toBe('xhigh')
    expect(effort({ output_config: { effort: 'max' }, thinking: on }, 'gpt-5.6-sol')).toBe('max')
    expect(effort({ output_config: { effort: 'max' }, thinking: on }, 'gpt-5.4')).toBe('xhigh')
    expect(effort({ output_config: { effort: 'high' }, thinking: { type: 'enabled', budget_tokens: 1000 } })).toBe('high')
    expect(effort({ output_config: { effort: 'high' } })).toBe('low')
    expect(effort({ output_config: { effort: 'high' }, thinking: { type: 'disabled' } })).toBe('low')
    expect(effort({ output_config: { effort: 'turbo' }, thinking: on })).toBeUndefined()
  })

  it('otherwise from thinking: adaptive is xhigh, a budget maps to low / medium / high', () => {
    expect(effort({ thinking: { type: 'adaptive' } })).toBe('xhigh')
    expect(effort({ thinking: { type: 'enabled', budget_tokens: 1000 } })).toBe('low')
    expect(effort({ thinking: { type: 'enabled', budget_tokens: 8000 } })).toBe('medium')
    expect(effort({ thinking: { type: 'enabled', budget_tokens: 32000 } })).toBe('high')
    expect(effort({ thinking: { type: 'enabled' } })).toBe('high')
    expect(effort({ thinking: { type: 'disabled' } })).toBeUndefined()
    expect(effort({})).toBeUndefined()
  })

  it('pro models never get an effort they reject', () => {
    expect(effort({ thinking: { type: 'enabled', budget_tokens: 1000 } }, 'gpt-5-pro')).toBe('high')
    expect(effort({ thinking: { type: 'enabled', budget_tokens: 1000 } }, 'gpt-5.4-pro')).toBe('medium')
    expect(effort({ thinking: { type: 'enabled', budget_tokens: 1000 } }, 'o3-pro')).toBe('low')
  })

  it('only models that take it get reasoning_effort', () => {
    expect(convert({ model: 'gpt-5.4', thinking: { type: 'adaptive' }, messages: [user('hi')] }).reasoning_effort).toBe('xhigh')
    expect(convert({ model: 'deepseek-v4-flash', thinking: { type: 'adaptive' }, messages: [user('hi')] })).not.toHaveProperty('reasoning_effort')
    expect(convert({ model: 'gpt-5.4', messages: [user('hi')] })).not.toHaveProperty('reasoning_effort')
  })
})

describe('non-streaming reply', () => {
  const reply = (message: Json, extra: Json = {}) => ({ id: 'chatcmpl-123', model: 'gpt-4', choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, ...extra })

  it('text, id kept, stop reason and usage', () => {
    expect(chatToAnthropic(reply({ content: 'Hello!' }))).toEqual({ id: 'chatcmpl-123', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Hello!' }], model: 'gpt-4', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } })
  })

  it('a leading inline think block (either tag) becomes thinking; only in the first text; anything else is text', () => {
    for (const content of ['<thinking>tool call</thinking>\n日志很大。', '<think>tool call</think>\n\n日志很大。'])
      expect(chatToAnthropic(reply({ content })).content).toEqual([{ type: 'thinking', thinking: 'tool call' }, { type: 'text', text: '日志很大。' }])
    expect(chatToAnthropic(reply({ content: [{ type: 'text', text: '<think>plan</think>answer' }, { type: 'text', text: '<think>kept</think>' }] })).content).toEqual([{ type: 'thinking', thinking: 'plan' }, { type: 'text', text: 'answer' }, { type: 'text', text: '<think>kept</think>' }])
    for (const content of ['<think>unclosed', 'see the <thinking>x</thinking> tag'])
      expect(chatToAnthropic(reply({ content })).content).toEqual([{ type: 'text', text: content }])
  })

  it('tool calls (and the legacy function_call), refusals, content filter', () => {
    const tools = chatToAnthropic({ ...reply({ content: null, tool_calls: [{ id: 'call_123', type: 'function', function: { name: 'get_weather', arguments: '{"location": "Tokyo"}' } }] }), choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_123', type: 'function', function: { name: 'get_weather', arguments: '{"location": "Tokyo"}' } }] }, finish_reason: 'tool_calls' }] })
    expect(tools.content).toEqual([{ type: 'tool_use', id: 'call_123', name: 'get_weather', input: { location: 'Tokyo' } }])
    expect(tools.stop_reason).toBe('tool_use')
    const legacy = chatToAnthropic({ id: 'x', choices: [{ message: { role: 'assistant', function_call: { name: 'lookup', arguments: '{"q":1}' } } }] })
    expect(legacy.content).toEqual([{ type: 'tool_use', id: '', name: 'lookup', input: { q: 1 } }])
    expect(legacy.stop_reason).toBe('tool_use')
    expect(chatToAnthropic(reply({ content: [{ type: 'text', text: 'part' }, { type: 'refusal', refusal: 'no' }] })).content).toEqual([{ type: 'text', text: 'part' }, { type: 'text', text: 'no' }])
    expect(chatToAnthropic({ ...reply({ content: 'x' }), choices: [{ message: { content: 'x' }, finish_reason: 'content_filter' }] }).stop_reason).toBe('end_turn')
    expect(() => chatToAnthropic({ id: 'x' })).toThrow('No choices')
  })

  it('deepSeek\'s reasoning comes back as thinking, and goes out again on the next tool turn', () => {
    const response = chatToAnthropic({ id: 'chatcmpl-deepseek', model: 'deepseek-v4-flash', choices: [{ message: { role: 'assistant', reasoning_content: 'Need the current date before calling weather.', content: 'Let me check the date first.', tool_calls: [{ id: 'call_date', type: 'function', function: { name: 'get_date', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] })
    expect(response.content.map((block: Json) => block.type)).toEqual(['thinking', 'text', 'tool_use'])
    const replayed = anthropicToChat({ model: 'deepseek-v4-flash', messages: [{ role: 'assistant', content: response.content }] }, true).messages[0]
    expect(replayed).toMatchObject({ reasoning_content: 'Need the current date before calling weather.', tool_calls: [{ id: 'call_date', function: { name: 'get_date' } }] })
  })

  it('usage: cache reads and writes come out of the input; a stub 0 falls through; never below 0', () => {
    const usage = (value: Json) => chatToAnthropic(reply({ content: 'x' }, { usage: value })).usage
    expect(usage({ prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 300 } })).toEqual({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 600, cache_creation_input_tokens: 300 })
    expect(usage({ prompt_tokens: 100, completion_tokens: 5, cache_read_input_tokens: 60, cache_creation_input_tokens: 10 })).toEqual({ input_tokens: 30, output_tokens: 5, cache_read_input_tokens: 60, cache_creation_input_tokens: 10 })
    expect(usage({ prompt_tokens: 6650, completion_tokens: 16, cache_read_input_tokens: 0, prompt_cache_hit_tokens: 6400 })).toEqual({ input_tokens: 250, output_tokens: 16, cache_read_input_tokens: 6400 })
    expect(usage({ prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 80 }, cache_creation_input_tokens: 50 })).toEqual({ input_tokens: 0, output_tokens: 50, cache_read_input_tokens: 80, cache_creation_input_tokens: 50 })
  })
})
