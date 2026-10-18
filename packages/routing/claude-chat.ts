import type { Json } from './json'
import { isOpenAiOSeries, supportsReasoningEffort } from './codex-chat'
import { splitLeadingThink } from './inline-think'
import { canonicalJson, isObject, str } from './json'
import { chatImagePart, flushToolMedia, planToolOutputMedia, queueToolMedia } from './tool-media'

/**
 * Anthropic Messages ↔ Chat Completions for Claude Code, ported from cc-switch's `transform.rs` (MIT): the request
 * (system, messages, tools, thinking), and a non-streaming reply with its usage.
 */

const billingHeaderPrefix = 'x-anthropic-billing-header:'

/**
 * Claude Code may open `system` with an attribution line whose `cch=` value changes on every request; forwarded, it
 * would break the provider's prompt cache. Only a leading one goes; the same text later on is the user's own.
 */
export function stripBillingHeader(text: string) {
  if (!text.startsWith(billingHeaderPrefix))
    return text
  const end = text.search(/[\r\n]/)
  if (end < 0)
    return ''
  let rest = text.slice(text[end] === '\r' && text[end + 1] === '\n' ? end + 2 : end + 1)
  if (rest.startsWith('\r\n'))
    rest = rest.slice(2)
  else if (rest.startsWith('\n') || rest.startsWith('\r'))
    rest = rest.slice(1)
  return rest
}

/**
 * Providers that want the reasoning of a tool-call turn sent back as `reasoning_content` (DeepSeek, MiMo), matched on
 * the model or the address. Kimi asked to be left out: replayed placeholders disturb its reasoning.
 */
const reasoningVendors = ['deepseek', 'mimo', 'xiaomimimo']
export const wantsReasoningReplay = (...values: (string | undefined)[]) => values.some(value => value && reasoningVendors.some(hint => value.toLowerCase().includes(hint)))

const maxEffortModels = new Set(['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'])

/**
 * Claude Code's effort or thinking budget as `reasoning_effort`. An explicit `output_config.effort` wins (`max` only
 * where the model has it); with thinking off it drops to `low`, because Claude Code keeps sending an effort then.
 * Otherwise adaptive thinking is `xhigh` and a budget maps to low / medium / high.
 */
function requestedEffort(body: Json, model: string): string | undefined {
  const effort = body?.output_config?.effort
  if (typeof effort === 'string') {
    const mapped = ['low', 'medium', 'high', 'xhigh'].includes(effort) ? effort : effort === 'max' ? (maxEffortModels.has(model.toLowerCase()) ? 'max' : 'xhigh') : undefined
    const thinkingOff = [undefined, 'disabled'].includes(str(body?.thinking?.type))
    return thinkingOff && mapped ? 'low' : mapped
  }
  const thinking = body?.thinking
  if (thinking?.type === 'adaptive')
    return 'xhigh'
  if (thinking?.type !== 'enabled')
    return undefined
  const budget = thinking.budget_tokens
  if (typeof budget !== 'number')
    return 'high'
  return budget < 4000 ? 'low' : budget < 16000 ? 'medium' : 'high'
}

/** The tiers each model accepts: `gpt-5-pro` takes only `high`, later `gpt-5.x-pro` models nothing below `medium`. */
function clampEffort(model: string, effort: string) {
  const name = model.toLowerCase()
  if (name === 'gpt-5-pro' || name.startsWith('gpt-5-pro-'))
    return 'high'
  const gptPro = name.startsWith('gpt-') && (name.endsWith('-pro') || name.includes('-pro-'))
  return gptPro && effort === 'low' ? 'medium' : effort
}

export function resolveReasoningEffort(body: Json): string | undefined {
  const model = str(body?.model) ?? ''
  const effort = requestedEffort(body, model)
  return effort && clampEffort(model, effort)
}

/** Strict Chat gateways want an object root schema and reject `format: uri`; nested schemas keep their own shape. */
export function cleanSchema(schema: Json, root = true): Json {
  if (!isObject(schema))
    return schema
  const out: Record<string, Json> = { ...schema }
  const missingType = root && !('type' in out)
  if (missingType)
    out.type = 'object'
  if (missingType && !('properties' in out))
    out.properties = {}
  if (out.format === 'uri')
    delete out.format
  if (isObject(out.properties))
    out.properties = Object.fromEntries(Object.entries(out.properties).map(([key, value]) => [key, cleanSchema(value, false)]))
  if (out.items !== undefined)
    out.items = cleanSchema(out.items, false)
  return out
}

/** Anthropic's tool choice in Chat's words: `any` is `required`, a named tool is a function selector. */
function toolChoiceToChat(choice: Json): Json {
  if (typeof choice === 'string')
    return choice === 'any' ? 'required' : choice
  if (!isObject(choice))
    return choice
  switch (choice.type) {
    case 'any': return 'required'
    case 'auto': return 'auto'
    case 'none': return 'none'
    case 'tool': return { type: 'function', function: { name: str(choice.name) ?? '' } }
    default: return choice
  }
}

/** One Anthropic message as Chat messages: tool results become `tool` messages, their media a user message after them. */
function messageToChat(role: string, content: Json, replayReasoning: boolean): Json[] {
  if (content === undefined || content === null)
    return [{ role, content: null }]
  if (typeof content === 'string')
    return [{ role, content }]
  if (!Array.isArray(content))
    return [{ role, content }]
  const out: Json[] = []
  const parts: Json[] = []
  const toolCalls: Json[] = []
  const pendingMedia: Json[] = []
  const reasoning: string[] = []
  for (const block of content) {
    switch (block?.type) {
      case 'text':
        if (typeof block.text === 'string')
          parts.push({ type: 'text', text: block.text })
        break
      case 'image': {
        const image = chatImagePart(block)
        if (image)
          parts.push(image)
        break
      }
      case 'tool_use':
        toolCalls.push({ id: str(block.id) ?? '', type: 'function', function: { name: str(block.name) ?? '', arguments: canonicalJson(block.input ?? {}) } })
        break
      case 'tool_result': {
        const id = str(block.tool_use_id) ?? ''
        const plan = block.content === undefined ? undefined : planToolOutputMedia(block.content)
        let text: string
        if (plan) {
          queueToolMedia(pendingMedia, id, plan.media)
          text = plan.content
        }
        else {
          // Without media, exactly what cc-switch sends, so prompt caches stay warm across the switch.
          text = typeof block.content === 'string' ? block.content : block.content === undefined ? '' : canonicalJson(block.content)
        }
        out.push({ role: 'tool', tool_call_id: id, content: text })
        break
      }
      case 'thinking':
        if (typeof block.thinking === 'string' && block.thinking)
          reasoning.push(block.thinking)
        break
      case 'redacted_thinking':
        // Claude Code keeps earlier thinking encrypted; providers that need some reasoning get a placeholder.
        if (replayReasoning)
          reasoning.push('[redacted thinking]')
        break
    }
  }
  // Chat tool messages can't carry images: parallel results stay together, then their media in one user message.
  flushToolMedia(out, pendingMedia)
  if (parts.length || toolCalls.length) {
    const message: Json = { role }
    message.content = !parts.length ? null : parts.length === 1 && typeof parts[0].text === 'string' ? parts[0].text : parts
    if (toolCalls.length)
      message.tool_calls = toolCalls
    if (replayReasoning && role === 'assistant' && toolCalls.length)
      message.reasoning_content = reasoning.length ? reasoning.join('\n') : 'tool call'
    out.push(message)
  }
  return out
}

/**
 * An Anthropic Messages request as a Chat Completions request. `replayReasoning`: the provider wants a tool-call
 * turn's reasoning back as `reasoning_content` (see `wantsReasoningReplay`); others never get that field.
 */
export function anthropicToChat(body: Json, replayReasoning = false): Json {
  const result: Json = {}
  const model = str(body?.model) ?? ''
  if (typeof body?.model === 'string')
    result.model = body.model
  const messages: Json[] = []
  const system = body?.system
  if (typeof system === 'string') {
    const text = stripBillingHeader(system)
    if (text)
      messages.push({ role: 'system', content: text })
  }
  else if (Array.isArray(system)) {
    // One system message, byte-stable across turns, so the prefix stays cacheable.
    const texts = system.map(part => typeof part?.text === 'string' ? stripBillingHeader(part.text) : '').filter(Boolean)
    if (texts.length)
      messages.push({ role: 'system', content: texts.join('\n') })
  }
  for (const message of Array.isArray(body?.messages) ? body.messages : []) messages.push(...messageToChat(str(message?.role) ?? 'user', message?.content, replayReasoning))
  result.messages = messages
  if (body?.max_tokens !== undefined)
    result[isOpenAiOSeries(model) ? 'max_completion_tokens' : 'max_tokens'] = body.max_tokens
  for (const [from, to] of [['temperature', 'temperature'], ['top_p', 'top_p'], ['stop_sequences', 'stop'], ['stream', 'stream']]) {
    if (body?.[from] !== undefined)
      result[to] = body[from]
  }
  if (supportsReasoningEffort(model)) {
    const effort = resolveReasoningEffort(body)
    if (effort)
      result.reasoning_effort = effort
  }
  const tools = (Array.isArray(body?.tools) ? body.tools : []).filter((tool: Json) => tool?.type !== 'BatchTool').map((tool: Json) => {
    const fn: Json = { name: str(tool?.name) ?? '' }
    // A missing description is left out: strict gateways reject `null`.
    if (tool?.description !== undefined && tool.description !== null)
      fn.description = tool.description
    fn.parameters = cleanSchema(tool?.input_schema ?? {})
    return { type: 'function', function: fn }
  })
  if (tools.length)
    result.tools = tools
  if (body?.tool_choice !== undefined)
    result.tool_choice = toolChoiceToChat(body.tool_choice)
  return result
}

/** The first of these that is a positive number (some relays send a stub 0 first and the real value later). */
function firstPositive(...values: Json[]): number | undefined {
  return values.find(value => typeof value === 'number' && value > 0)
}

/**
 * Chat usage as Anthropic usage. Chat's prompt tokens include cache reads and writes, Anthropic's input tokens don't,
 * so both are taken out: input + cache read + cache creation = prompt tokens.
 */
export function anthropicUsage(usage: Json): Json {
  const cached = firstPositive(usage?.cache_read_input_tokens, usage?.prompt_tokens_details?.cached_tokens, usage?.prompt_cache_hit_tokens) ?? 0
  const created = typeof usage?.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : firstPositive(usage?.prompt_tokens_details?.cache_write_tokens, usage?.input_tokens_details?.cache_write_tokens) ?? 0
  const prompt = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0
  const out: Json = { input_tokens: Math.max(0, prompt - cached - created), output_tokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0 }
  if (cached > 0)
    out.cache_read_input_tokens = cached
  if (created > 0)
    out.cache_creation_input_tokens = created
  return out
}

export function stopReasonOf(finishReason?: string) {
  if (finishReason === undefined)
    return undefined
  return finishReason === 'tool_calls' || finishReason === 'function_call' ? 'tool_use' : finishReason === 'length' ? 'max_tokens' : 'end_turn'
}

/** A non-streaming Chat Completions reply as an Anthropic message. */
export function chatToAnthropic(body: Json): Json {
  const choice = Array.isArray(body?.choices) ? body.choices[0] : undefined
  if (!Array.isArray(body?.choices))
    throw new Error('No choices in response')
  if (!choice)
    throw new Error('Empty choices array')
  const message = choice.message
  if (!message)
    throw new Error('No message in choice')
  const content: Json[] = []
  if (typeof message.reasoning_content === 'string' && message.reasoning_content)
    content.push({ type: 'thinking', thinking: message.reasoning_content })
  // A leading inline think block in the first text becomes thinking, as in the streaming path.
  let leading = true
  const pushText = (text: string) => {
    const split = leading ? splitLeadingThink(text) : undefined
    leading = false
    if (!split)
      return content.push({ type: 'text', text })
    if (split[0])
      content.push({ type: 'thinking', thinking: split[0] })
    if (split[1])
      content.push({ type: 'text', text: split[1] })
  }
  if (typeof message.content === 'string' && message.content) {
    pushText(message.content)
  }
  else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if ((part?.type === 'text' || part?.type === 'output_text') && typeof part.text === 'string' && part.text)
        pushText(part.text)
      else if (part?.type === 'refusal' && typeof part.refusal === 'string' && part.refusal)
        content.push({ type: 'text', text: part.refusal })
    }
  }
  if (typeof message.refusal === 'string' && message.refusal)
    content.push({ type: 'text', text: message.refusal })
  const parseInput = (value: Json) => {
    if (isObject(value) || Array.isArray(value))
      return value
    try { return typeof value === 'string' ? JSON.parse(value) : {} }
    catch { return {} }
  }
  let toolUse = false
  for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    toolUse = true
    content.push({ type: 'tool_use', id: str(call?.id) ?? '', name: str(call?.function?.name) ?? '', input: parseInput(call?.function?.arguments ?? '{}') })
  }
  // The legacy single `function_call`.
  const legacy = message.function_call
  if (!toolUse && isObject(legacy) && (str(legacy.name) || legacy.arguments !== undefined)) {
    content.push({ type: 'tool_use', id: str(legacy.id) ?? '', name: str(legacy.name) ?? '', input: parseInput(legacy.arguments) })
    toolUse = true
  }
  return {
    id: str(body.id) ?? '',
    type: 'message',
    role: 'assistant',
    content,
    model: str(body.model) ?? '',
    stop_reason: stopReasonOf(str(choice.finish_reason)) ?? (toolUse ? 'tool_use' : null),
    stop_sequence: null,
    usage: anthropicUsage(body.usage ?? {}),
  }
}

/** Anthropic's error types by HTTP status, for a provider's error in Claude Code's terms. */
export function anthropicErrorType(status: number) {
  const types: Record<number, string> = { 400: 'invalid_request_error', 401: 'authentication_error', 402: 'billing_error', 403: 'permission_error', 404: 'not_found_error', 413: 'request_too_large', 429: 'rate_limit_error', 529: 'overloaded_error' }
  return types[status] ?? (status >= 500 ? 'api_error' : 'invalid_request_error')
}
