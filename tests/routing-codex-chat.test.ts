import type { Json } from '../packages/routing/json'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { chatCompletionToResponse, chatErrorToResponseError, chatUsageToResponses, mapEffort, responsesToChat, toolContextFrom } from '../packages/routing/codex-chat'
import { canonicalJson } from '../packages/routing/json'
import { mediaMovedMarker } from '../packages/routing/tool-media'

/**
 * Codex Responses ↔ Chat Completions. Cases ported from cc-switch's `transform_codex_chat.rs` tests (MIT), with the
 * same inputs and expectations; markers carry Anna's name instead of cc-switch's.
 */

const largeImage = () => `data:image/png;base64,${Buffer.from('CC_SWITCH_TOOL_MEDIA_SENTINEL'.repeat(400)).toString('base64')}`
const roles = (result: Json) => result.messages.map((message: Json) => message.role)
const call = (callId: string) => ({ type: 'function_call', call_id: callId, name: 'view_image', arguments: '{}' })
const output = (callId: string, value: Json) => ({ type: 'function_call_output', call_id: callId, output: value })
const convert = (input: Json[]) => responsesToChat({ model: 'kimi-k3', input })
const convertDeepSeek = (input: Json[]) => responsesToChat({ model: 'deepseek/deepseek-v4-flash', input })
const orphanMarker = '[tool_result without a matching tool_call]'

/** Every assistant tool-call message is followed by exactly its results, nothing in between. */
function expectCompleteToolTurns(result: Json) {
  const pending = new Set<string>()
  for (const message of result.messages) {
    if (pending.size)
      expect(message.role, JSON.stringify(result)).toBe('tool')
    if (message.role === 'tool')
      expect(pending.delete(message.tool_call_id)).toBe(true)
    for (const toolCall of message.tool_calls ?? []) {
      expect(pending.has(toolCall.id)).toBe(false)
      pending.add(toolCall.id)
    }
  }
  expect(pending.size).toBe(0)
}

describe('history repair for DeepSeek', () => {
  it('only for DeepSeek models', () => {
    for (const [model, repair] of [['deepseek-v4-flash', true], ['deepseek/deepseek-v4-flash', true], ['deepseek-ai/DeepSeek-V3.2', true], ['Pro/deepseek-ai/DeepSeek-R1', true], ['DEEPSEEK-CHAT', true], ['deepseek', true], ['gpt-5.4', false], ['kimi-k3', false], ['glm-5.2', false], ['custom-alias', false], ['deepseek/gpt-5.4', false], ['not-deepseek-v4-flash', false]] as const) {
      const result = responsesToChat({ model, input: [call('call_1'), { type: 'message', role: 'assistant', content: 'Replay text.', reasoning_content: 'replay thought' }, output('call_1', 'ok')] })
      if (repair) {
        expectCompleteToolTurns(result)
        expect(roles(result), model).toEqual(['assistant', 'tool'])
        expect(result.messages[0].content).toBe('Replay text.')
        expect(result.messages[0].reasoning_content).toBe('replay thought')
      }
      else {
        expect(result.messages, model).toEqual([
          { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'view_image', arguments: '{}' } }], reasoning_content: 'tool call' },
          { role: 'assistant', content: 'Replay text.', reasoning_content: 'replay thought' },
          { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
        ])
      }
    }
  })

  it('keeps well-formed history byte for byte', () => {
    const items = [
      { type: 'message', role: 'user', content: 'Inspect the image.' },
      { type: 'message', role: 'assistant', content: 'Checking.' },
      call('call_1'),
      call('call_2'),
      output('call_2', ''),
      output('call_1', [{ type: 'text', text: 'image result' }, { type: 'input_image', image_url: 'https://example.com/image.png' }]),
      { type: 'message', role: 'assistant', content: 'Image inspected.', reasoning_content: 'final answer thought' },
      { type: 'message', role: 'user', content: 'Continue.' },
      call('call_next'),
      output('call_next', 'ok'),
    ]
    const deepseek = convertDeepSeek(structuredClone(items))
    expectCompleteToolTurns(deepseek)
    expect(JSON.stringify(deepseek.messages)).toBe(JSON.stringify(convert(items).messages))
  })

  it('keeps an empty assistant replay inside the tool turn', () => {
    for (const empty of [{ type: 'message', role: 'assistant', content: null }, { type: 'message', role: 'assistant', content: null, reasoning_content: 'tool-only thought' }, { type: 'message', role: 'assistant', content: '' }, { type: 'message', role: 'assistant', content: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '' }] }, { type: 'message', role: 'assistant' }, { role: 'assistant', content: '' }, { type: 'future_message', role: 'assistant', content: '' }, { type: 'input_text', role: 'assistant', text: '' }] as Json[]) {
      const result = convertDeepSeek([call('call_1'), empty, output('call_1', '')])
      expectCompleteToolTurns(result)
      expect(roles(result)).toEqual(['assistant', 'tool'])
      expect(result.messages[0].tool_calls[0].id).toBe('call_1')
      expect(result.messages[1].content).toBe('')
      if (empty.reasoning_content)
        expect(result.messages[0].reasoning_content).toBe(empty.reasoning_content)
    }
  })

  it('coalesces custom and tool-search replays', () => {
    for (const [toolCall, result] of [
      [{ type: 'custom_tool_call', call_id: 'call_1', name: 'apply_patch', input: 'patch' }, { type: 'custom_tool_call_output', call_id: 'call_1', output: 'ok' }],
      [{ type: 'tool_search_call', call_id: 'call_1', arguments: { query: 'shell' } }, { type: 'tool_search_output', call_id: 'call_1', output: [] }],
    ]) {
      const converted = convertDeepSeek([toolCall, { type: 'message', role: 'assistant', content: '' }, result])
      expectCompleteToolTurns(converted)
      expect(roles(converted)).toEqual(['assistant', 'tool'])
      expect(converted.messages[1].content).toBe(canonicalJson(result))
    }
  })

  it('keeps replayed text and reasoning on the one tool-call message', () => {
    const result = convertDeepSeek([
      { ...call('call_1'), reasoning_content: 'first thought' },
      { type: 'message', role: 'assistant', content: 'First update.', reasoning_content: 'second thought' },
      { ...call('call_2'), reasoning_content: 'third thought' },
      { type: 'message', role: 'assistant', content: 'Second update.' },
      output('call_1', 'first result'),
      output('call_2', 'second result'),
    ])
    expectCompleteToolTurns(result)
    expect(roles(result)).toEqual(['assistant', 'tool', 'tool'])
    expect(result.messages[0].content).toBe('First update.\nSecond update.')
    expect(result.messages[0].reasoning_content).toBe('first thought\n\nsecond thought\n\nthird thought')
    expect(result.messages[0].tool_calls.map((toolCall: Json) => toolCall.id)).toEqual(['call_1', 'call_2'])
  })

  it('coalesces a replay between parallel results', () => {
    const result = convertDeepSeek([call('call_1'), call('call_2'), output('call_2', 'second result'), { type: 'message', role: 'assistant', content: 'Still working.', reasoning_content: 'waiting for the first result' }, output('call_1', 'first result'), { type: 'message', role: 'assistant', content: 'Done.' }])
    expectCompleteToolTurns(result)
    expect(roles(result)).toEqual(['assistant', 'tool', 'tool', 'assistant'])
    expect(result.messages[0]).toMatchObject({ content: 'Still working.', reasoning_content: 'waiting for the first result' })
    expect(result.messages.slice(1, 3).map((message: Json) => message.tool_call_id)).toEqual(['call_2', 'call_1'])
    expect(result.messages[3].content).toBe('Done.')
  })

  it('keeps a multimodal replay as parts', () => {
    const result = convertDeepSeek([
      { type: 'message', role: 'assistant', content: 'Opening the image.' },
      call('call_1'),
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Image context.' }, { type: 'refusal', refusal: 'Cannot identify a person.' }, { type: 'input_image', image_url: 'https://example.com/image.png' }] },
      output('call_1', 'ok'),
    ])
    expectCompleteToolTurns(result)
    expect(roles(result)).toEqual(['assistant', 'tool'])
    expect(result.messages[0].content).toEqual([{ type: 'text', text: 'Opening the image.' }, { type: 'text', text: 'Image context.' }, { type: 'text', text: 'Cannot identify a person.' }, { type: 'image_url', image_url: { url: 'https://example.com/image.png' } }])
  })

  it('keeps user and system boundaries, and calls without results', () => {
    for (const role of ['user', 'system']) {
      const result = convertDeepSeek([call('call_missing'), { type: 'message', role, content: 'New context.' }, { type: 'message', role: 'assistant', content: 'Next turn.' }, call('call_next'), output('call_next', 'ok')])
      const assistants = result.messages.filter((message: Json) => message.role === 'assistant')
      expect(assistants.map((message: Json) => message.tool_calls[0].id)).toEqual(['call_missing', 'call_next'])
      expect(assistants[1].content).toBe('Next turn.')
      expect(result.messages.filter((message: Json) => message.role === 'tool').map((message: Json) => message.tool_call_id)).toEqual(['call_next'])
    }
  })
})

describe('tool results without a matching call', () => {
  it('become user messages (no call id, unknown call id, or more results than calls)', () => {
    const noId = convert([{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }, { type: 'function_call_output', output: 'delegation-result' }])
    expect(roles(noId)).not.toContain('tool')
    expect(noId.messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('delegation-result') })
    const unknown = convert([{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }, output('call_missing', 'stale-result')])
    expect(roles(unknown)).not.toContain('tool')
    expect(unknown.messages.at(-1).content).toContain('stale-result')
    expect(unknown.messages.at(-1).content).toContain('call_missing')
    const extra = convert([{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }, call('call_a'), output('call_a', 'ok-a'), output('call_b', 'orphan-b')])
    expect(extra.messages.filter((message: Json) => message.role === 'tool').map((message: Json) => message.tool_call_id)).toEqual(['call_a'])
    expect(extra.messages.some((message: Json) => message.role === 'user' && String(message.content).includes('orphan-b'))).toBe(true)
  })

  it('a paired result stays a tool message', () => {
    const result = convert([{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }, call('call_pair_1'), output('call_pair_1', 'tool-result')])
    expect(result.messages.find((message: Json) => message.role === 'tool')).toEqual({ role: 'tool', tool_call_id: 'call_pair_1', content: 'tool-result' })
  })

  it('codex desktop\'s delegation receipt (call_id null) is not a tool message', () => {
    const result = convert([{ role: 'user', content: [{ type: 'input_text', text: 'environment-context' }] }, { type: 'function_call_output', name: 'create_thread', namespace: 'codex_app', call_id: null, output: '<codex_delegation>...</codex_delegation>' }])
    expect(roles(result)).not.toContain('tool')
    expect(result.messages.some((message: Json) => String(message.content).includes('codex_delegation'))).toBe(true)
  })

  it('keeps media as parts, not base64 text', () => {
    const image = largeImage()
    const result = convert([{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }, output('', [{ type: 'input_text', text: 'screenshot follows' }, { type: 'input_image', image_url: image }])])
    expect(roles(result)).toEqual(['user', 'user'])
    const [text, media] = result.messages[1].content
    expect(text.text.startsWith(orphanMarker)).toBe(true)
    expect(text.text).toContain('screenshot follows')
    expect(text.text).not.toContain(image)
    expect(media).toEqual({ type: 'image_url', image_url: { url: image } })
  })

  it('waits for the end of a parallel result run', () => {
    const result = convert([{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }, call('call_a'), call('call_b'), output('call_a', 'ok-a'), output('call_orphan', 'orphan-in-middle'), output('call_b', 'ok-b')])
    expect(roles(result)).toEqual(['user', 'assistant', 'tool', 'tool', 'user'])
    expect([result.messages[2].tool_call_id, result.messages[3].tool_call_id]).toEqual(['call_a', 'call_b'])
    expect(result.messages[4].content).toContain('orphan-in-middle')
  })

  it('doesn\'t move reasoning: trailing reasoning goes back to the assistant, forward reasoning to the next call', () => {
    const back = convert([{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'commentary' }] }, { type: 'reasoning', summary: [{ type: 'summary_text', text: 'trailing-before-orphan' }] }, { type: 'function_call_output', output: 'orphan-payload' }, { role: 'user', content: [{ type: 'input_text', text: 'next' }] }])
    expect(roles(back)).toEqual(['user', 'assistant', 'user', 'user'])
    expect(back.messages[1].reasoning_content).toBe('trailing-before-orphan')
    expect(back.messages[3].content).toBe('next')
    const forward = convert([{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'commentary' }] }, { type: 'reasoning', summary: [{ type: 'summary_text', text: 'think-before-call' }] }, { type: 'function_call_output', output: 'orphan-payload' }, call('call_next'), output('call_next', 'next-result')])
    expect(roles(forward)).toEqual(['user', 'assistant', 'user', 'assistant', 'tool'])
    expect(forward.messages[1].reasoning_content).toBeUndefined()
    expect(forward.messages[3]).toMatchObject({ reasoning_content: 'think-before-call', tool_calls: [{ id: 'call_next' }] })
  })
})

describe('request fields', () => {
  it('maps reasoning effort per provider mode; ultra clamps where the vocabulary is known', () => {
    expect(mapEffort('ultra')).toBe('ultra')
    expect(mapEffort('ultra', 'deepseek')).toBe('max')
    expect(mapEffort('ultra', 'low_high')).toBe('high')
    expect(mapEffort('ultra', 'openrouter')).toBe('xhigh')
    expect(mapEffort('turbo')).toBeUndefined()
  })

  it('asks for usage in streams, keeping the client\'s stream options', () => {
    const input = [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }]
    expect(responsesToChat({ model: 'kimi-k2.6', input, stream: true })).toMatchObject({ stream: true, stream_options: { include_usage: true } })
    expect(responsesToChat({ model: 'kimi-k2.6', input })).not.toHaveProperty('stream_options')
    expect(responsesToChat({ model: 'kimi-k2.6', input, stream: true, stream_options: { continuous_usage_stats: true } }).stream_options).toEqual({ continuous_usage_stats: true, include_usage: true })
  })

  it('maps files and audio; a URL-only file isn\'t a Chat file', () => {
    const result = responsesToChat({ model: 'gpt-5.4', input: [{ role: 'user', content: [{ type: 'input_text', text: 'Summarize this.' }, { type: 'input_file', file_id: 'file_123', file_url: 'https://example.com/spec.pdf', filename: 'spec.pdf' }, { type: 'input_audio', input_audio: { data: 'UklGRg==', format: 'wav' } }] }] })
    expect(result.messages[0].content).toEqual([{ type: 'text', text: 'Summarize this.' }, { type: 'file', file: { file_id: 'file_123', filename: 'spec.pdf' } }, { type: 'input_audio', input_audio: { data: 'UklGRg==', format: 'wav' } }])
    expect(responsesToChat({ model: 'gpt-5.4', input: [{ role: 'user', content: [{ type: 'input_text', text: 'Summarize this URL file.' }, { type: 'input_file', file_url: 'https://example.com/spec.pdf' }] }] }).messages[0].content).toBe('Summarize this URL file.')
    expect(responsesToChat({ model: 'gpt-5.4', input: [{ type: 'input_file', file_id: 'file_top', filename: 'top.pdf' }] }).messages[0]).toEqual({ role: 'user', content: [{ type: 'file', file: { file_id: 'file_top', filename: 'top.pdf' } }] })
  })

  it('a top-level user part ends the reasoning that came before it', () => {
    const result = responsesToChat({ model: 'gpt-5.4', input: [{ type: 'reasoning', summary: [{ text: 'stale reasoning' }] }, { type: 'input_text', text: 'Please run the tool.' }, { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{}' }], tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }] })
    expect(result.messages[0]).toEqual({ role: 'user', content: 'Please run the tool.' })
    expect(result.messages[1]).toMatchObject({ role: 'assistant', reasoning_content: 'tool call' })
  })
})

describe('tools and messages', () => {
  it('maps messages, tools, choice and limits', () => {
    const result = responsesToChat({
      model: 'gpt-5.4',
      instructions: 'You are concise.',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'Weather?' }, { type: 'input_image', image_url: 'data:image/png;base64,abc' }, { type: 'input_text', text: 'Use Celsius.' }] },
        { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"Tokyo"}' },
        { type: 'function_call_output', call_id: 'call_1', output: 'Sunny' },
      ],
      tools: [{ type: 'function', name: 'get_weather', description: 'Get weather', parameters: { type: 'object' }, strict: true }],
      tool_choice: { type: 'function', name: 'get_weather' },
      max_output_tokens: 100,
      reasoning: { effort: 'high' },
      stream: true,
    })
    expect(roles(result)).toEqual(['system', 'user', 'assistant', 'tool'])
    expect(result.messages[1].content.map((part: Json) => part.type)).toEqual(['text', 'image_url', 'text'])
    expect(result.messages[1].content[2].text).toBe('Use Celsius.')
    expect(result.messages[2].tool_calls[0].id).toBe('call_1')
    expect(result.tools[0].function).toMatchObject({ name: 'get_weather', strict: true })
    expect(result.tool_choice.function.name).toBe('get_weather')
    expect(result).toMatchObject({ model: 'gpt-5.4', max_tokens: 100, reasoning_effort: 'high' })
  })

  it('leaves out a missing description, and always gives object parameters', () => {
    const tools = responsesToChat({ model: 'gpt-5.4', input: 'hi', tools: [{ type: 'function', name: 'no_desc', parameters: { type: 'object' } }, { type: 'function', name: 'with_desc', description: 'Has one', parameters: { type: 'object' } }] }).tools
    expect(tools[0].function).not.toHaveProperty('description')
    expect(tools[1].function.description).toBe('Has one')
    for (const tool of [{ type: 'function', name: 'codex_app__automation_update', description: 'Update an automation.', parameters: null }, { type: 'function', function: { name: 'codex_app__automation_update', description: 'Update an automation.', parameters: null } }, { type: 'function', function: { name: 'codex_app__automation_update', description: 'Update an automation.' } }])
      expect(responsesToChat({ model: 'gpt-5.4', input: 'hi', tools: [tool] }).tools[0].function.parameters).toEqual({ type: 'object', properties: {} })
    expect(responsesToChat({ model: 'gpt-5.4', input: 'hi', tools: [{ type: 'function', name: 'search', parameters: { type: null, properties: { query: { type: 'string' } }, required: ['query'] } }] }).tools[0].function.parameters).toEqual({ type: 'object', properties: { query: { type: 'string' } }, required: ['query'] })
    const oneOf = [{ type: 'object', properties: { id: { type: 'string' } } }, { type: 'object', properties: { slug: { type: 'string' } } }]
    expect(responsesToChat({ model: 'gpt-5.4', input: 'hi', tools: [{ type: 'function', name: 'lookup', parameters: { oneOf } }] }).tools[0].function.parameters).toEqual({ oneOf, type: 'object' })
  })

  it('exposes tool search and the namespace tools it loaded', () => {
    const result = responsesToChat({
      model: 'gpt-5.4',
      tools: [{ type: 'tool_search' }],
      input: [
        { type: 'tool_search_call', call_id: 'call_tool_search_1', status: 'completed', execution: 'client', arguments: { query: 'Gmail search emails', limit: 5 } },
        { type: 'tool_search_output', call_id: 'call_tool_search_1', status: 'completed', execution: 'client', tools: [{ type: 'namespace', name: 'mcp__codex_apps__gmail', description: 'Find and reference emails from your inbox.', tools: [{ type: 'function', name: '_search_emails', description: 'Search Gmail for emails matching a query.', strict: false, parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer' } }, required: ['query'] } }] }] },
        { type: 'message', role: 'user', content: 'Search unread inbox mail.' },
      ],
    })
    const names = result.tools.map((tool: Json) => tool.function.name)
    expect(names).toContain('tool_search')
    expect(names).toContain('mcp__codex_apps__gmail___search_emails')
    expect(result.messages[0].tool_calls[0].function.name).toBe('tool_search')
    expect(result.messages[1]).toMatchObject({ role: 'tool', tool_call_id: 'call_tool_search_1', content: expect.stringContaining('mcp__codex_apps__gmail') })
  })

  it('custom tools (apply_patch) become functions taking their raw input, with the original definition described', () => {
    const result = responsesToChat({ model: 'gpt-5.4', tools: [{ type: 'custom', name: 'apply_patch', description: 'Apply a patch to files.' }], tool_choice: { type: 'custom', name: 'apply_patch' }, input: [{ type: 'custom_tool_call', id: 'ctc_1', call_id: 'call_patch', name: 'apply_patch', input: '*** Begin Patch\n*** End Patch' }] })
    expect(result.tools[0].function.name).toBe('apply_patch')
    expect(result.tools[0].function.parameters.required).toEqual(['input'])
    expect(result.tool_choice.function.name).toBe('apply_patch')
    expect(result.messages[0].tool_calls[0].function.arguments).toBe('{"input":"*** Begin Patch\\n*** End Patch"}')
    const description = responsesToChat({ model: 'gpt-5.4', tools: [{ type: 'custom', name: 'apply_patch', description: 'Use the `apply_patch` tool to edit files.', format: { type: 'grammar', syntax: 'lark', definition: 'start: begin_patch hunk+ end_patch' } }] }).tools[0].function.description
    expect(description.startsWith('Original tool definition:')).toBe(true)
    expect(description).toContain('"type":"custom"')
    expect(description).toContain('"syntax":"lark"')
  })

  it('codex\'s internal roles: developer is system, everything unknown is user; system messages merge at the head', () => {
    const result = responsesToChat({ model: 'gpt-5.4', input: [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Follow project instructions.' }] }, { type: 'message', role: 'latest_reminder', content: 'Keep the reply brief.' }, { type: 'message', role: 'unknown_codex_role', content: 'Fallback content.' }] })
    expect(result.messages).toEqual([{ role: 'system', content: 'Follow project instructions.' }, { role: 'user', content: 'Keep the reply brief.' }, { role: 'user', content: 'Fallback content.' }])
    const merged = responsesToChat({ model: 'MiniMax-M2.7', instructions: 'You are Codex.', input: [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Permissions block' }] }, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'AGENTS.md' }] }, { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Collaboration Mode: Default' }] }, { type: 'message', role: 'user', content: [{ type: 'input_text', text: '你好' }] }] })
    expect(roles(merged)).toEqual(['system', 'user', 'user'])
    expect(merged.messages[0].content).toBe('You are Codex.\n\nPermissions block\n\nCollaboration Mode: Default')
  })

  it('an additional_tools carrier is lifted into tools, not turned into a message; top-level tools win', () => {
    const result = responsesToChat({ model: 'agnes-3.0-flash', input: [{ type: 'additional_tools', id: 'at_a8d5b9f5', role: 'developer', tools: [{ type: 'namespace', name: 'functions', description: '', tools: [{ type: 'function', name: 'exec_command', description: 'Run a shell command.', strict: false, parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] } }] }, { type: 'function', name: 'wait', description: 'Waits on a yielded exec cell.', strict: false, parameters: { type: 'object', properties: { cell_id: { type: 'string' } }, required: ['cell_id'] } }] }, { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'You are Codex, a coding agent.' }] }, { type: 'message', role: 'user', content: [{ type: 'input_text', text: '你好' }] }] })
    expect(result.messages).toEqual([{ role: 'system', content: 'You are Codex, a coding agent.' }, { role: 'user', content: '你好' }])
    expect(result.tools.map((tool: Json) => tool.function.name)).toEqual(['functions__exec_command', 'wait'])
    const deduped = responsesToChat({ model: 'm', tools: [{ type: 'function', name: 'wait', description: 'Top-level wait.', parameters: { type: 'object', properties: {} } }], input: [{ type: 'additional_tools', role: 'developer', tools: [{ type: 'function', name: 'wait', description: 'Carried wait.', parameters: { type: 'object', properties: {} } }] }, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }] })
    expect(deduped.tools).toEqual([{ type: 'function', function: { name: 'wait', description: 'Top-level wait.', parameters: { type: 'object', properties: {} } } }])
  })

  it('a namespaced name past 64 characters is shortened with a hash, and maps back', () => {
    const long = 'mcp__a_really_long_connector_namespace_for_testing'
    const context = toolContextFrom({ tools: [{ type: 'namespace', name: long, tools: [{ type: 'function', name: 'search_everything_everywhere', parameters: {} }] }] })
    const chatName = context.chatTools[0].function.name
    expect(chatName.length).toBeLessThanOrEqual(64)
    expect(context.chatNameFor('search_everything_everywhere', long)).toBe(chatName)
    expect(context.lookup(chatName)).toEqual({ kind: 'namespace', name: 'search_everything_everywhere', namespace: long })
  })
})

describe('reasoning settings per provider (codexChatReasoning)', () => {
  const config = (overrides: Json) => ({ supportsThinking: true, supportsEffort: true, thinkingParam: 'thinking', effortParam: 'reasoning_effort', ...overrides })
  const run = (model: string, effort: string, settings: Json) => responsesToChat({ model, input: 'hello', reasoning: { effort } }, settings)

  it('deepSeek: thinking on, effort in its own words', () => {
    expect(run('deepseek-v4-pro', 'xhigh', config({ effortValueMode: 'deepseek' }))).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'max' })
    const off = run('deepseek-v4-pro', 'none', config({ effortValueMode: 'deepseek' }))
    expect(off.thinking).toEqual({ type: 'disabled' })
    expect(off).not.toHaveProperty('reasoning_effort')
    expect(off).not.toHaveProperty('reasoning')
  })

  it('openRouter: its reasoning object, max clamped to xhigh, an explicit none passed through', () => {
    const openrouter = config({ supportsThinking: false, thinkingParam: 'none', effortParam: 'reasoning.effort', effortValueMode: 'openrouter' })
    const max = run('deepseek/deepseek-chat-v3.1', 'max', openrouter)
    expect(max.reasoning).toEqual({ effort: 'xhigh' })
    expect(max).not.toHaveProperty('reasoning_effort')
    expect(max).not.toHaveProperty('thinking')
    expect(run('deepseek/deepseek-chat-v3.1', 'high', openrouter).reasoning).toEqual({ effort: 'high' })
    const none = run('openai/gpt-5', 'none', openrouter)
    expect(none.reasoning).toEqual({ effort: 'none' })
    expect(none).not.toHaveProperty('reasoning_effort')
  })

  it('zen: clamps to the levels the model declares, and sends none without them', () => {
    const zen = (levels?: string[]) => config({ thinkingParam: 'none', effortValueMode: 'zen', effortLevels: levels })
    for (const [effort, expected] of [['minimal', 'high'], ['low', 'high'], ['medium', 'high'], ['high', 'high'], ['xhigh', 'max'], ['max', 'max'], ['ultra', 'max']])
      expect(run('glm-5.2', effort, zen(['high', 'max'])).reasoning_effort, effort).toBe(expected)
    for (const [effort, expected] of [['minimal', 'low'], ['low', 'low'], ['medium', 'high'], ['xhigh', 'max']])
      expect(run('deepseek-v4-flash', effort, zen(['low', 'high', 'max'])).reasoning_effort, effort).toBe(expected)
    for (const effort of ['minimal', 'medium', 'high', 'max'])
      expect(run('kimi-k3', effort, zen(['max'])).reasoning_effort).toBe('max')
    const none = run('glm-5.1', 'medium', zen())
    expect(none).not.toHaveProperty('reasoning_effort')
    expect(none).not.toHaveProperty('thinking')
  })

  it('thinking-only and enable_thinking providers get no effort', () => {
    const kimi = run('kimi-k2.6', 'high', config({ supportsEffort: false, effortParam: 'none' }))
    expect(kimi.thinking).toEqual({ type: 'enabled' })
    expect(kimi).not.toHaveProperty('reasoning_effort')
    const qwen = run('qwen3-max', 'medium', config({ supportsEffort: false, thinkingParam: 'enable_thinking', effortParam: 'none' }))
    expect(qwen.enable_thinking).toBe(true)
    expect(qwen).not.toHaveProperty('reasoning_effort')
  })
})

describe('reasoning goes back to the turn it belongs to', () => {
  const summary = (text: string) => ({ type: 'reasoning', summary: [{ type: 'summary_text', text }] })

  it('forward to the next assistant message or call batch; trailing to the previous; never across a user turn', () => {
    const forward = responsesToChat({ model: 'gpt-5.4', input: [summary('Need to inspect the repo.'), { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I will check the files.' }] }, { type: 'message', role: 'user', content: 'Continue' }] })
    expect(forward.messages).toEqual([{ role: 'assistant', content: 'I will check the files.', reasoning_content: 'Need to inspect the repo.' }, { role: 'user', content: 'Continue' }])
    const trailing = responsesToChat({ model: 'gpt-5.4', input: [{ type: 'message', role: 'assistant', content: 'I checked the files.' }, summary('The answer came from README.'), { type: 'message', role: 'user', content: 'Continue' }] })
    expect(trailing.messages).toEqual([{ role: 'assistant', content: 'I checked the files.', reasoning_content: 'The answer came from README.' }, { role: 'user', content: 'Continue' }])
    expect(responsesToChat({ model: 'gpt-5.4', input: [{ type: 'message', role: 'assistant', reasoning_content: 'I need to preserve thinking history.', content: 'Done.' }] }).messages[0].reasoning_content).toBe('I need to preserve thinking history.')
    expect(responsesToChat({ model: 'gpt-5.4', input: [{ type: 'message', role: 'assistant', reasoning_content: 'Embedded thought.', content: 'Done.' }, summary('Trailing thought.'), { type: 'message', role: 'user', content: 'Continue' }] }).messages[0].reasoning_content).toBe('Embedded thought.\n\nTrailing thought.')
  })

  it('on tool-call messages: from a reasoning item, from the call itself, trailing, or a placeholder', () => {
    const read = { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"README.md"}' }
    const readOutput = { type: 'function_call_output', call_id: 'call_1', output: 'Readme content' }
    expect(responsesToChat({ model: 'gpt-5.4', input: [{ type: 'reasoning', summary: 'Need to read a file.' }, read, readOutput] }).messages[0]).toMatchObject({ role: 'assistant', reasoning_content: 'Need to read a file.', tool_calls: [{ id: 'call_1' }] })
    expect(responsesToChat({ model: 'gpt-5.4', input: [{ ...read, reasoning_content: 'Need to read a file.' }, readOutput] }).messages[0].reasoning_content).toBe('Need to read a file.')
    expect(responsesToChat({ model: 'kimi-k2-thinking', input: [read, readOutput] }).messages[0].reasoning_content).toBe('tool call')
    expect(responsesToChat({ model: 'gpt-5.4', input: [read, readOutput, { type: 'reasoning', summary: 'Need to read a file.' }] }).messages[0].reasoning_content).toBe('Need to read a file.')
  })

  it('each answer keeps its own reasoning across a multi-turn history', () => {
    const answers = responsesToChat({ model: 'kimi-k2-thinking', input: [summary('first thought'), { type: 'message', role: 'assistant', content: 'First answer.' }, summary('second thought'), { type: 'message', role: 'assistant', content: 'Second answer.' }, { role: 'user', content: 'Continue' }] })
    expect(answers.messages).toEqual([{ role: 'assistant', content: 'First answer.', reasoning_content: 'first thought' }, { role: 'assistant', content: 'Second answer.', reasoning_content: 'second thought' }, { role: 'user', content: 'Continue' }])
    const afterTool = responsesToChat({ model: 'kimi-k2-thinking', input: [summary('need to read a file'), { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"README.md"}' }, { type: 'function_call_output', call_id: 'call_1', output: 'Readme content' }, summary('now I can answer'), { type: 'message', role: 'assistant', content: 'The file says hello.' }, { role: 'user', content: 'Continue' }] })
    expect(roles(afterTool)).toEqual(['assistant', 'tool', 'assistant', 'user'])
    expect(afterTool.messages[0].reasoning_content).toBe('need to read a file')
    expect(afterTool.messages[2]).toEqual({ role: 'assistant', content: 'The file says hello.', reasoning_content: 'now I can answer' })
  })
})

describe('tool results', () => {
  it('parallel calls on one message, results right after; JSON payloads canonical, plain text as is', () => {
    const result = responsesToChat({ model: 'gpt-5.4', input: [{ type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"README.md"}' }, { type: 'function_call', call_id: 'call_2', name: 'list_files', arguments: '{"path":"src"}' }, { type: 'function_call_output', call_id: 'call_1', output: 'Readme content' }, { type: 'function_call_output', call_id: 'call_2', output: ['main.rs', 'lib.rs'] }, { role: 'user', content: 'Continue' }] })
    expect(roles(result)).toEqual(['assistant', 'tool', 'tool', 'user'])
    expect(result.messages[0].tool_calls.map((toolCall: Json) => toolCall.id)).toEqual(['call_1', 'call_2'])
    expect(result.messages[2].content).toBe('["main.rs","lib.rs"]')
    const canonical = responsesToChat({ model: 'gpt-5.4', input: [{ type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{ "b": 2, "a": 1 }' }, { type: 'function_call_output', call_id: 'call_1', output: '{ "z": true, "a": [2, 1] }' }] })
    expect(canonical.messages[0].tool_calls[0].function.arguments).toBe('{"a":1,"b":2}')
    expect(canonical.messages[1].content).toBe('{"a":[2,1],"z":true}')
    const plain = responsesToChat({ model: 'gpt-5.4', input: [{ type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{}' }, { type: 'function_call_output', call_id: 'call_1', output: 'plain text result' }] })
    expect(plain.messages[1].content).toBe('plain text result')
  })
})

describe('replayed tool calls with arguments that aren\'t a JSON object', () => {
  const request = (args: Json): Json => ({ model: 'test-model', input: [{ role: 'assistant', content: 'Looking up the result.' }, { type: 'function_call', call_id: 'call_broken', name: 'lookup', arguments: args, reasoning_content: 'Existing reasoning.' }, { type: 'function_call_output', call_id: 'call_broken', output: 'failed to parse function arguments: unexpected end of input' }, { role: 'user', content: 'continue' }], tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object', properties: { query: { type: 'string' } } } }] })

  it('become context text with their error, never a new call', () => {
    const raw = '{"query":"unfinished'
    const result = responsesToChat(request(raw))
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]).not.toHaveProperty('tool_calls')
    for (const kept of ['Looking up the result.', 'lookup', raw, 'failed to parse function arguments'])
      expect(result.messages[0].content).toContain(kept)
    expect(result.messages[0].reasoning_content).toContain('Existing reasoning.')
    expect(result.messages[1]).toEqual({ role: 'user', content: 'continue' })
    for (const args of ['not json', '[]', '42', 'true', 'null', '"text"']) {
      const other = responsesToChat(request(args))
      expect(other.messages.some((message: Json) => message.tool_calls || message.role === 'tool')).toBe(false)
      expect(other.messages[0].content).toContain(args)
    }
  })

  it('a valid parallel call stays paired, in either result order', () => {
    for (const badFirst of [true, false]) {
      const body = request('{broken')
      body.input.splice(2, 0, { type: 'function_call', call_id: 'call_ok', name: 'lookup', arguments: '{"query":"weather"}' })
      body.input.splice(badFirst ? 4 : 3, 0, { type: 'function_call_output', call_id: 'call_ok', output: 'sunny' })
      const result = responsesToChat(body)
      expect(result.messages).toHaveLength(3)
      expect(result.messages[0].tool_calls).toEqual([{ id: 'call_ok', type: 'function', function: { name: 'lookup', arguments: '{"query":"weather"}' } }])
      expect(result.messages[0].content).toContain('failed to parse function arguments')
      expect(result.messages[1]).toEqual({ role: 'tool', tool_call_id: 'call_ok', content: 'sunny' })
    }
  })

  it('valid objects and argument-less calls are untouched; media and missing results survive', () => {
    for (const args of ['{"query":"weather"}', { query: 'weather' }, '{}', '']) {
      const result = responsesToChat(request(args))
      expect(result.messages).toHaveLength(3)
      expect(result.messages[0].tool_calls[0].id).toBe('call_broken')
      expect(typeof JSON.parse(result.messages[0].tool_calls[0].function.arguments)).toBe('object')
    }
    const withMedia = request('{broken')
    withMedia.input[2].output = [{ type: 'input_text', text: 'failed to parse function arguments' }, { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' }]
    const media = responsesToChat(withMedia)
    expect(media.messages.some((message: Json) => message.tool_calls || message.role === 'tool')).toBe(false)
    expect(media.messages.some((message: Json) => message.role === 'user' && Array.isArray(message.content) && message.content.some((part: Json) => part.image_url?.url === 'data:image/png;base64,aGVsbG8='))).toBe(true)
    const missing = request('{broken')
    missing.input.splice(2, 1)
    const noResult = responsesToChat(missing)
    expect(noResult.messages[0].content).toContain('{broken')
    expect(noResult.messages.at(-1).content).toBe('continue')
  })
})

describe('media in tool results moves to a user message after the results', () => {
  it('an image result: a marker in the tool message, the image after', () => {
    const image = largeImage()
    const result = convert([call('call_image'), output('call_image', [{ type: 'input_text', text: 'screenshot follows' }, { type: 'input_image', image_url: image }])])
    expect(roles(result)).toEqual(['assistant', 'tool', 'user'])
    const toolContent = JSON.parse(result.messages[1].content)
    expect(toolContent[0].text).toBe('screenshot follows')
    expect(toolContent[1]).toEqual({ type: 'text', text: mediaMovedMarker })
    expect(result.messages[1].content).not.toContain(image)
    expect(result.messages[2].content[0].text).toBe('[anna: media output of tool call call_image]')
    expect(result.messages[2].content[1]).toEqual({ type: 'image_url', image_url: { url: image } })
  })

  it('parallel results stay adjacent, their media grouped after them', () => {
    const image = largeImage()
    const result = convert([call('call_1'), call('call_2'), output('call_1', { type: 'input_image', image_url: image }), { type: 'reasoning', summary: [{ type: 'summary_text', text: 'keep outputs adjacent' }] }, output('call_2', { type: 'image', mimeType: 'image/webp', data: 'MCP_TOOL_MEDIA_SENTINEL' })])
    expect(roles(result)).toEqual(['assistant', 'tool', 'tool', 'user'])
    expect(result.messages[0].reasoning_content).toBe('keep outputs adjacent')
    expect(result.messages[1].content).not.toContain(image)
    expect(result.messages[2].content).not.toContain('MCP_TOOL_MEDIA_SENTINEL')
    expect(result.messages[3].content).toHaveLength(4)
    expect(result.messages[3].content[3].image_url.url).toBe('data:image/webp;base64,MCP_TOOL_MEDIA_SENTINEL')
  })

  it('media goes out before the next call batch, and before a real user message', () => {
    const next = convert([call('call_1'), output('call_1', { type: 'input_image', image_url: largeImage() }), call('call_2'), output('call_2', 'second result')])
    expect(roles(next)).toEqual(['assistant', 'tool', 'user', 'assistant', 'tool'])
    expect(next.messages[3].tool_calls[0].id).toBe('call_2')
    for (const boundary of [{ type: 'input_text', text: 'continue' }, { type: 'future_message', role: 'user', content: 'continue' }]) {
      const result = convert([call('call_1'), output('call_1', { type: 'input_image', image_url: largeImage() }), boundary])
      expect(roles(result)).toEqual(['assistant', 'tool', 'user', 'user'])
      expect(Array.isArray(result.messages[2].content)).toBe(true)
    }
  })

  it('a whole-string data URL moves only past 8 KB', () => {
    const large = largeImage()
    const big = convert([call('call_large'), output('call_large', large)])
    expect(roles(big)).toEqual(['assistant', 'tool', 'user'])
    expect(big.messages[1].content).toBe(mediaMovedMarker)
    expect(big.messages[2].content[1].image_url.url).toBe(large)
    const small = convert([call('call_small'), output('call_small', 'data:image/png;base64,YWJj')])
    expect(roles(small)).toEqual(['assistant', 'tool'])
    expect(small.messages[1].content).toBe('data:image/png;base64,YWJj')
  })

  it('understands the image shapes tools return', () => {
    const cases: [Json, string, string | undefined][] = [
      [{ type: 'input_image', image_url: { url: 'https://example.com/input.png' }, detail: 'high' }, 'https://example.com/input.png', 'high'],
      [{ type: 'image_url', image_url: 'https://example.com/chat-string.png' }, 'https://example.com/chat-string.png', undefined],
      [{ type: 'image_url', image_url: { url: 'https://example.com/chat-object.png', detail: 'low' } }, 'https://example.com/chat-object.png', 'low'],
      [{ image_url: 'data:image/gif;base64,LOOSE_SENTINEL' }, 'data:image/gif;base64,LOOSE_SENTINEL', undefined],
      [{ type: 'image', source: { media_type: 'image/jpeg', data: 'ANTHROPIC_SENTINEL' } }, 'data:image/jpeg;base64,ANTHROPIC_SENTINEL', undefined],
      [{ type: 'image', mimeType: 'image/webp', data: 'MCP_SENTINEL' }, 'data:image/webp;base64,MCP_SENTINEL', undefined],
    ]
    cases.forEach(([value, url, detail], index) => {
      const result = convert([call(`call_shape_${index}`), output(`call_shape_${index}`, value)])
      expect(roles(result)).toEqual(['assistant', 'tool', 'user'])
      expect(result.messages[2].content[1]).toEqual({ type: 'image_url', image_url: detail ? { url, detail } : { url } })
    })
  })
})

describe('more media shapes, and outputs that must stay byte-stable', () => {
  it('finds media inside a JSON string and a content wrapper; files and audio too', () => {
    const wrapped = convert([call('call_string'), output('call_string', JSON.stringify({ content: [{ type: 'input_text', text: 'MCP response' }, { type: 'image', mimeType: 'image/png', data: 'STRING_MCP_SENTINEL' }] }))])
    expect(roles(wrapped)).toEqual(['assistant', 'tool', 'user'])
    const toolContent = JSON.parse(wrapped.messages[1].content)
    expect(toolContent.content.map((part: Json) => part.text)).toEqual(['MCP response', mediaMovedMarker])
    expect(wrapped.messages[1].content).not.toContain('STRING_MCP_SENTINEL')
    expect(wrapped.messages[2].content[1].image_url.url).toBe('data:image/png;base64,STRING_MCP_SENTINEL')
    const files = convert([call('call_media'), output('call_media', { content: [{ type: 'input_file', file_id: 'file_123', filename: 'report.pdf' }, { type: 'input_audio', input_audio: { data: 'AUDIO_SENTINEL', format: 'wav' } }] })])
    expect(files.messages[2].content.slice(1)).toEqual([{ type: 'file', file: { file_id: 'file_123', filename: 'report.pdf' } }, { type: 'input_audio', input_audio: { data: 'AUDIO_SENTINEL', format: 'wav' } }])
  })

  it('custom and tool-search outputs keep their item shape, media moved out; leftover base64 is clamped', () => {
    for (const [toolCall, result] of [
      [{ type: 'custom_tool_call', call_id: 'call_custom', name: 'render', input: 'draw' }, { type: 'custom_tool_call_output', call_id: 'call_custom', status: 'completed', output: { content: [{ type: 'input_image', image_url: 'data:image/png;base64,CUSTOM_SENTINEL' }] } }],
      [{ type: 'tool_search_call', call_id: 'call_search', arguments: { query: 'image tool' } }, { type: 'tool_search_output', call_id: 'call_search', status: 'completed', output: { content: [{ type: 'image', mimeType: 'image/png', data: 'SEARCH_SENTINEL' }] } }],
    ] as Json[][]) {
      const converted = convert([toolCall, result])
      expect(roles(converted)).toEqual(['assistant', 'tool', 'user'])
      expect(JSON.parse(converted.messages[1].content)).toMatchObject({ type: result.type, status: 'completed', output: { content: [{ text: mediaMovedMarker }] } })
    }
    const encoded = JSON.stringify({ content: [{ type: 'input_image', image_url: 'data:image/png;base64,CUSTOM_STRING_IMAGE_SENTINEL' }, { type: 'video', data: 'A'.repeat(20000) }] })
    const clamped = convert([{ type: 'custom_tool_call', call_id: 'call_custom_string', name: 'render', input: 'draw' }, { type: 'custom_tool_call_output', call_id: 'call_custom_string', status: 'completed', output: encoded }])
    const rewritten = JSON.parse(clamped.messages[1].content).output
    expect(rewritten).toContain('[anna: omitted 20000 bytes]')
    expect(rewritten).not.toContain('A'.repeat(64))
    expect(rewritten).not.toContain('CUSTOM_STRING_IMAGE_SENTINEL')
    expect(clamped.messages[2].content[1].type).toBe('image_url')
  })

  it('doesn\'t mistake metadata, non-image data or a plain thumbnail link for media', () => {
    for (const [index, value] of [{ type: 'image', name: 'business metadata' }, { type: 'image', mimeType: 'text/plain', data: 'NOT_AN_IMAGE' }, { image_url: { url: 'https://example.com/search-thumbnail.png' } }].entries()) {
      const result = convert([call(`call_false_positive_${index}`), output(`call_false_positive_${index}`, value)])
      expect(roles(result)).toEqual(['assistant', 'tool'])
      expect(result.messages[1].content).toBe(canonicalJson(value))
    }
  })

  it('outputs without media keep their exact bytes', () => {
    const cases: [Json, string][] = [['plain text', 'plain text'], ['{ "z": true, "a": [2, 1] }', '{"a":[2,1],"z":true}'], [['main.rs', 'lib.rs'], '["main.rs","lib.rs"]'], [{ z: true, a: [2, 1] }, '{"a":[2,1],"z":true}'], [[], '[]'], [undefined, '']]
    cases.forEach(([value, expected], index) => {
      const item: Json = { type: 'function_call_output', call_id: `call_stable_${index}` }
      if (value !== undefined)
        item.output = value
      expect(convert([call(`call_stable_${index}`), item]).messages[1].content).toBe(expected)
    })
    for (const [toolCall, item] of [
      [{ type: 'custom_tool_call', call_id: 'call_custom', name: 'render', input: 'draw' }, { type: 'custom_tool_call_output', call_id: 'call_custom', status: 'completed', output: { text: 'unchanged' } }],
      [{ type: 'tool_search_call', call_id: 'call_search', arguments: { query: 'noop' } }, { type: 'tool_search_output', call_id: 'call_search', status: 'completed', output: [] }],
    ])
      expect(convert([toolCall, item]).messages[1].content).toBe(canonicalJson(item))
  })
})

describe('commentary and its tool calls are one assistant turn', () => {
  const update = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Part 1 written. Appending sections 4-5.' }] }
  const thought = { type: 'reasoning', summary: [{ type: 'summary_text', text: 'need to update the file' }] }

  it('an unknown item still closes a call batch (as before), reasoning goes to the next batch', () => {
    const result = convert([call('call_1'), { type: 'future_metadata', value: 1 }, { type: 'reasoning', summary: [{ type: 'summary_text', text: 'second batch reasoning' }] }, call('call_2'), output('call_1', 'first result'), output('call_2', 'second result')])
    expect(roles(result)).toEqual(['assistant', 'assistant', 'tool', 'tool'])
    expect(result.messages[0]).toMatchObject({ tool_calls: [{ id: 'call_1' }], reasoning_content: 'tool call' })
    expect(result.messages[1]).toMatchObject({ tool_calls: [{ id: 'call_2' }], reasoning_content: 'second batch reasoning' })
  })

  it('commentary then call(s) merge; reasoning segments aren\'t repeated', () => {
    const merged = convert([thought, update, { ...call('call_1'), reasoning_content: 'need to update the file' }, output('call_1', 'Success')])
    expect(roles(merged)).toEqual(['assistant', 'tool'])
    expect(merged.messages[0]).toMatchObject({ content: 'Part 1 written. Appending sections 4-5.', tool_calls: [{ id: 'call_1' }], reasoning_content: 'need to update the file' })
    expect(merged.messages[0].tool_calls).toHaveLength(1)
    const two = convert([thought, update, { ...call('call_1'), reasoning_content: 'need to update the file' }, { ...call('call_2'), reasoning_content: 'second section planning' }, output('call_1', 'Success 1'), output('call_2', 'Success 2')])
    expect(two.messages[0].reasoning_content).toBe('need to update the file\n\nsecond section planning')
    const between = convert([update, thought, { ...call('call_1'), reasoning_content: 'need to update the file' }, output('call_1', 'Success')])
    expect(roles(between)).toEqual(['assistant', 'tool'])
    expect(between.messages[0].reasoning_content).toBe('need to update the file')
    const placeholder = convert([{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Running the build now.' }] }, call('call_build'), output('call_build', 'Build succeeded')])
    expect(placeholder.messages[0]).toMatchObject({ content: 'Running the build now.', reasoning_content: 'tool call' })
  })

  it('but not across a user turn, and media of the earlier batch goes first', () => {
    const boundary = convert([{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done for now.' }] }, { type: 'message', role: 'user', content: 'Continue with the next file.' }, call('call_next'), output('call_next', 'Next result')])
    expect(roles(boundary)).toEqual(['assistant', 'user', 'assistant', 'tool'])
    expect(boundary.messages[0]).not.toHaveProperty('tool_calls')
    expect(boundary.messages[2].content).toBeNull()
    const custom = responsesToChat({ model: 'kimi-k3', tools: [{ type: 'custom', name: 'apply_patch', description: 'Apply a patch to files.' }], input: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Applying the next patch.' }] }, { type: 'custom_tool_call', id: 'ctc_1', call_id: 'call_patch', name: 'apply_patch', input: '*** Begin Patch\n*** End Patch' }, { type: 'custom_tool_call_output', call_id: 'call_patch', output: { text: 'Success' } }] })
    expect(roles(custom)).toEqual(['assistant', 'tool'])
    expect(custom.messages[0]).toMatchObject({ content: 'Applying the next patch.', tool_calls: [{ id: 'call_patch' }] })
    const image = largeImage()
    const media = convert([call('call_media'), output('call_media', { content: [{ type: 'input_image', image_url: image }] }), { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Viewing the image now.' }] }, call('call_next'), output('call_next', 'Next result')])
    expect(roles(media)).toEqual(['assistant', 'tool', 'user', 'assistant', 'tool'])
    expect(media.messages[2].content.some((part: Json) => part.image_url?.url === image)).toBe(true)
    expect(media.messages[3]).toMatchObject({ content: 'Viewing the image now.', tool_calls: [{ id: 'call_next' }] })
  })
})

describe('the rest of the request', () => {
  it('a long multi-round history has no text-only assistant turns', () => {
    const items: Json[] = [{ type: 'message', role: 'user', content: 'Fix the failing build.' }]
    for (const index of [1, 2, 3])
      items.push({ type: 'reasoning', summary: [{ type: 'summary_text', text: `round ${index} reasoning` }] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Step ${index}: checking the logs.` }] }, { ...call(`call_round_${index}`), reasoning_content: `round ${index} reasoning` }, output(`call_round_${index}`, `round ${index} result`))
    items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Build fixed.' }] })
    const result = convert(items)
    expect(roles(result)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'tool', 'assistant'])
    result.messages.forEach((message: Json, index: number) => {
      if (message.role === 'assistant' && index + 1 < result.messages.length)
        expect(message.tool_calls?.length, `assistant ${index}`).toBeGreaterThan(0)
    })
    expect(result.messages[1]).toMatchObject({ content: 'Step 1: checking the logs.', tool_calls: [{ id: 'call_round_1' }], reasoning_content: 'round 1 reasoning' })
    expect(result.messages[7]).toEqual({ role: 'assistant', content: 'Build fixed.' })
  })

  it('clamps only leftover base64, never long ordinary text; media conversion is deterministic', () => {
    const image = largeImage()
    const longText = `${'ordinary OCR text with spaces. '.repeat(3500)}end`
    const encoded = JSON.stringify([{ type: 'input_image', image_url: image }, { type: 'text', text: longText }, { type: 'video', data: 'A'.repeat(20000) }])
    const text = convert([call('call_clamp'), output('call_clamp', encoded)]).messages[1].content
    const content = JSON.parse(text)
    expect(content[1].text).toBe(longText)
    expect(content[2].data.startsWith('[anna: omitted 20000 bytes]')).toBe(true)
    expect(text).not.toContain(image)
    const input = [call('call_repeat'), output('call_repeat', { content: [{ type: 'input_image', image_url: largeImage() }] })]
    expect(convert(structuredClone(input))).toEqual(convert(structuredClone(input)))
  })

  it('drops tool_choice and parallel_tool_calls when no tools are left', () => {
    expect(responsesToChat({ model: 'qwen3-7-max', tool_choice: 'auto', input: 'hi' })).toEqual({ model: 'qwen3-7-max', messages: [{ role: 'user', content: 'hi' }] })
    for (const body of [{ tools: [], tool_choice: 'auto' }, { tool_choice: 'auto', parallel_tool_calls: true }, { tools: [{ type: 'function' }], tool_choice: 'auto' }, { tool_choice: 'none' }, {}]) {
      const result = responsesToChat({ model: 'gpt-5.4', input: 'hi', ...body })
      expect(result).not.toHaveProperty('tools')
      expect(result).not.toHaveProperty('tool_choice')
      expect(result).not.toHaveProperty('parallel_tool_calls')
    }
    const tools = [{ type: 'function', name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } }]
    expect(responsesToChat({ model: 'gpt-5.4', tools, tool_choice: 'auto', parallel_tool_calls: true, input: 'hi' })).toMatchObject({ tool_choice: 'auto', parallel_tool_calls: true, tools: [{ function: { name: 'get_weather' } }] })
    expect(responsesToChat({ model: 'gpt-5.4', tools, tool_choice: { type: 'function', name: 'get_weather' }, input: 'hi' }).tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } })
    expect(responsesToChat({ model: 'gpt-5.4', tool_choice: 'auto', input: [{ type: 'tool_search_output', call_id: 'call_ts_1', status: 'completed', execution: 'client', tools: [{ type: 'function', name: 'search_docs', description: 'Search documentation.', parameters: { type: 'object', properties: { query: { type: 'string' } } } }] }] })).toMatchObject({ tool_choice: 'auto', tools: [{ function: { name: 'search_docs' } }] })
  })

  it('remote compaction: a tool-free summary turn; summaries replay as text, foreign blobs as a note', () => {
    const own = (summary: string, prefix: string) => `${prefix}${Buffer.from(summary).toString('base64url')}`
    for (const prefix of ['anna-compaction-v1:', 'ccswitch-compaction-v1:']) {
      const result = responsesToChat({ model: 'kimi-k3', stream: true, input: [{ type: 'compaction', id: 'cmp_1', encrypted_content: own('earlier progress', prefix) }, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix bug' }] }, { type: 'function_call', call_id: 'call_1', name: 'shell', arguments: '{}' }, { type: 'function_call_output', call_id: 'call_1', output: 'ok' }, { type: 'compaction_trigger' }], tools: [{ type: 'function', name: 'shell', parameters: { type: 'object' } }], tool_choice: 'auto', parallel_tool_calls: true })
      expect(result).not.toHaveProperty('tools')
      expect(result).not.toHaveProperty('tool_choice')
      expect(result).not.toHaveProperty('parallel_tool_calls')
      expect(JSON.stringify(result.messages[0].content)).toContain('earlier progress')
      expect(JSON.stringify(result.messages[0].content)).toContain('Another language model started to solve this problem')
      expect(result.messages.at(-1).role).toBe('user')
      expect(JSON.stringify(result.messages.at(-1).content)).toContain('CONTEXT CHECKPOINT COMPACTION')
      expect(roles(result)).toContain('tool')
    }
    const foreign = JSON.stringify(responsesToChat({ model: 'kimi-k3', input: [{ type: 'compaction', encrypted_content: 'gAAAAB-openai-blob' }, { type: 'context_compaction' }, { type: 'message', role: 'user', content: 'continue' }] }).messages)
    expect(foreign).toContain('stored in a format this model cannot read')
    expect(foreign).not.toContain('gAAAAB-openai-blob')
  })
})

describe('chat usage → responses usage', () => {
  it('always has input token details; cache reads from wherever they are reported, a stub 0 doesn\'t count', () => {
    expect(chatUsageToResponses({ prompt_tokens: 13, completion_tokens: 245, total_tokens: 258, prompt_tokens_details: { cached_tokens: 0 } }).input_tokens_details).toEqual({ cached_tokens: 0 })
    expect(chatUsageToResponses(undefined).input_tokens_details).toEqual({ cached_tokens: 0 })
    expect(chatUsageToResponses({ prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, prompt_cache_hit_tokens: 600, prompt_cache_miss_tokens: 400 })).toMatchObject({ input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 600, cache_write_tokens: 0 } })
    expect(chatUsageToResponses({ prompt_tokens: 6650, completion_tokens: 16, total_tokens: 6666, cache_read_input_tokens: 0, prompt_cache_hit_tokens: 6400 })).toMatchObject({ input_tokens: 6650, input_tokens_details: { cached_tokens: 6400 } })
    expect(chatUsageToResponses({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0 }, cache_read_input_tokens: 40 })).toMatchObject({ input_tokens_details: { cached_tokens: 40 }, cache_read_input_tokens: 40 })
    const zero = chatUsageToResponses({ prompt_tokens_details: { cached_tokens: 12 }, cache_read_input_tokens: 0 })
    expect(zero.input_tokens_details.cached_tokens).toBe(12)
    expect(zero).not.toHaveProperty('cache_read_input_tokens')
    expect(chatUsageToResponses({ prompt_tokens_details: { cached_tokens: 12 }, cache_read_input_tokens: 'invalid' })).not.toHaveProperty('cache_read_input_tokens')
    expect(chatUsageToResponses({ prompt_tokens_details: { cached_tokens: 'invalid' }, input_tokens_details: { cached_tokens: 7 } }).input_tokens_details.cached_tokens).toBe(7)
  })
})

describe('non-streaming chat response → responses response', () => {
  const chat = (message: Json, finish = 'tool_calls', extra: Json = {}) => ({ id: 'chatcmpl_1', object: 'chat.completion', created: 123, model: 'gpt-5.4', choices: [{ message: { role: 'assistant', ...message }, finish_reason: finish }], ...extra })

  it('reasoning, text, tool calls and usage', () => {
    const result = chatCompletionToResponse(chat({ reasoning_content: 'I should check the weather before answering.', content: 'Let me check.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' } }] }, 'tool_calls', { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 } } }))
    expect(result).toMatchObject({ id: 'resp_chatcmpl_1', status: 'completed', usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 } } })
    expect(result.output.map((item: Json) => item.type)).toEqual(['reasoning', 'message', 'function_call'])
    expect(result.output[0].summary[0].text).toBe('I should check the weather before answering.')
    expect(result.output[1].content[0].text).toBe('Let me check.')
    expect(result.output[2]).toMatchObject({ call_id: 'call_1', reasoning_content: 'I should check the weather before answering.' })
    const minimax = chatCompletionToResponse({ id: 'chatcmpl_minimax', created: 123, model: 'MiniMax-M2.7', choices: [{ message: { role: 'assistant', reasoning_details: [{ type: 'reasoning_text', text: 'Need to inspect the code.' }], content: 'Done' }, finish_reason: 'stop' }] })
    expect(minimax.output[0].summary[0].text).toBe('Need to inspect the code.')
    expect(minimax.output[1].content[0].text).toBe('Done')
  })

  it('restores namespace, tool-search and custom calls from the request\'s tools', () => {
    const namespaced = toolContextFrom({ tools: [{ type: 'tool_search' }], input: [{ type: 'tool_search_output', call_id: 'call_tool_search_1', status: 'completed', execution: 'client', tools: [{ type: 'namespace', name: 'mcp__codex_apps__gmail', tools: [{ type: 'function', name: '_search_emails', parameters: { type: 'object', properties: { query: { type: 'string' } } } }] }] }] })
    expect(chatCompletionToResponse(chat({ tool_calls: [{ id: 'call_gmail', type: 'function', function: { name: 'mcp__codex_apps__gmail___search_emails', arguments: '{"query":"-in:spam -in:trash","label_ids":["UNREAD"],"max_results":5}' } }] }), namespaced).output[0]).toMatchObject({ type: 'function_call', call_id: 'call_gmail', namespace: 'mcp__codex_apps__gmail', name: '_search_emails', arguments: '{"label_ids":["UNREAD"],"max_results":5,"query":"-in:spam -in:trash"}' })
    const search = toolContextFrom({ tools: [{ type: 'tool_search' }], input: 'Find tools.' })
    expect(chatCompletionToResponse(chat({ tool_calls: [{ id: 'call_tool_search_1', type: 'function', function: { name: 'tool_search', arguments: '{"query":"Gmail search emails","limit":10}' } }] }), search).output[0]).toEqual({ type: 'tool_search_call', call_id: 'call_tool_search_1', status: 'completed', execution: 'client', arguments: { query: 'Gmail search emails', limit: 10 } })
    const custom = toolContextFrom({ tools: [{ type: 'custom', name: 'apply_patch' }], input: 'Patch it.' })
    expect(chatCompletionToResponse(chat({ tool_calls: [{ id: 'call_patch', type: 'function', function: { name: 'apply_patch', arguments: '{"input":"*** Begin Patch\\n*** End Patch"}' } }] }), custom).output[0]).toEqual({ id: 'ctc_call_patch', type: 'custom_tool_call', status: 'completed', call_id: 'call_patch', name: 'apply_patch', input: '*** Begin Patch\n*** End Patch' })
  })

  it('a turn left with only nameless tool calls is an error; a truncated one stays incomplete', () => {
    expect(() => chatCompletionToResponse(chat({ content: '让我继续处理这个文件', tool_calls: [{ id: 'call_bad', type: 'function', function: { arguments: '{}' } }] }))).toThrow('without a function name')
    expect(() => chatCompletionToResponse(chat({ tool_calls: [{ id: 'call_ws', type: 'function', function: { name: '   ', arguments: '{}' } }] }))).toThrow()
    expect(() => chatCompletionToResponse(chat({ function_call: { id: 'call_legacy', arguments: '{}' } }, 'function_call'))).toThrow()
    const mixed = chatCompletionToResponse(chat({ tool_calls: [{ id: 'call_bad', type: 'function', function: { arguments: '{}' } }, { id: 'call_good', type: 'function', function: { name: 'exec_command', arguments: '{"cmd":"ls"}' } }] }))
    expect(mixed.output).toHaveLength(1)
    expect(mixed.output[0]).toMatchObject({ name: 'exec_command', call_id: 'call_good' })
    expect(chatCompletionToResponse(chat({ content: '我来看看', tool_calls: [{ id: 'call_cut', type: 'function', function: { arguments: '{"pa' } }] }, 'length'))).toMatchObject({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })
    expect(chatCompletionToResponse(chat({ content: '完成了' }, 'stop')).status).toBe('completed')
    expect(chatCompletionToResponse(chat({ content: 'partial' }, 'length'))).toMatchObject({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })
  })

  it('canonical arguments, and an inline think block becomes reasoning', () => {
    expect(chatCompletionToResponse(chat({ tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{ "b": 2, "a": 1 }' } }] })).output[0].arguments).toBe('{"a":1,"b":2}')
    const think = chatCompletionToResponse(chat({ content: '<think>\nI should answer with pong.\n</think>\n\npong' }, 'stop', { usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 18 } } }))
    expect(think.output[0].summary[0].text).toBe('I should answer with pong.')
    expect(think.output[1].content[0].text).toBe('pong')
    expect(think.usage.output_tokens_details.reasoning_tokens).toBe(18)
  })
})

describe('upstream errors in the shape Codex reads', () => {
  it('openAI, MiniMax, plain text, empty and detail-only bodies', () => {
    expect(chatErrorToResponseError({ error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'invalid_api_key', param: 'api_key' } })).toEqual({ error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'invalid_api_key', param: 'api_key' } })
    expect(chatErrorToResponseError({ base_resp: { status_code: 2013, status_msg: 'invalid params, chat content has invalid message role: system' } })).toEqual({ error: { message: 'invalid params, chat content has invalid message role: system', type: 'upstream_error', code: 2013, param: null } })
    expect(chatErrorToResponseError('Upstream timeout')).toEqual({ error: { message: 'Upstream timeout', type: 'upstream_error', code: null, param: null } })
    expect(chatErrorToResponseError(undefined).error).toMatchObject({ message: 'Upstream returned an empty error response', type: 'upstream_error' })
    expect(chatErrorToResponseError({ detail: 'rate limit exceeded' }).error).toMatchObject({ message: 'rate limit exceeded', type: 'upstream_error' })
  })
})
