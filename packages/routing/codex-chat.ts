import type { Json } from './json'
import { Buffer } from 'node:buffer'
import { compactionReplayText, compactPrompt, isCompactionRequest, userMessageItem } from './compaction'
import { splitLeadingThink } from './inline-think'
import { canonicalArguments, canonicalizeIfJson, canonicalJson, isObject, shortSha256, str } from './json'
import { chatFileFromInputFile, flushToolMedia, mediaMovedMarker, planToolOutputMedia, queueToolMedia, stripToolMedia } from './tool-media'

/**
 * Codex (OpenAI Responses) ↔ OpenAI Chat Completions, ported from cc-switch's `transform_codex_chat.rs` (MIT).
 * Used when Codex talks to Anna's routing service and the provider only speaks Chat Completions. Stateless: what
 * Codex replays (reasoning summaries, tool calls) carries everything the next request needs.
 */

/** How a Chat provider takes reasoning settings (cc-switch's `codexChatReasoning` on a preset). */
export interface ChatReasoning {
  supportsThinking?: boolean
  supportsEffort?: boolean
  /** `thinking` ({type: enabled|disabled}), `enable_thinking` or `reasoning_split`. */
  thinkingParam?: string
  /** `reasoning_effort` (top level) or `reasoning.effort` (OpenRouter's object). */
  effortParam?: string
  /** `passthrough`, `deepseek`, `low_high`, `openrouter` or `zen`. */
  effortValueMode?: string
  /** For `zen`: the levels the model accepts. */
  effortLevels?: string[]
}

const passthroughFields = ['frequency_penalty', 'logit_bias', 'logprobs', 'metadata', 'n', 'parallel_tool_calls', 'presence_penalty', 'response_format', 'seed', 'service_tier', 'stop', 'stream_options', 'top_logprobs', 'user']
const toolSearchName = 'tool_search'
const customInputField = 'input'
const orphanMarker = '[tool_result without a matching tool_call]'
const chatToolNameMax = 64
const customInputDescription = 'Raw string input for the original custom tool. Preserve formatting exactly and follow the original tool definition embedded in the description.'

type ToolKind = 'function' | 'namespace' | 'custom' | 'tool_search'
interface ToolSpec { kind: ToolKind, name: string, namespace?: string }

/** The tools of one request, under their Chat names, so the response can restore Codex's own kinds and names. */
export class CodexToolContext {
  readonly chatTools: Json[] = []
  private specs = new Map<string, ToolSpec>()
  private namespaced = new Map<string, string>()
  compaction = false

  lookup(chatName: string) { return this.specs.get(chatName) }
  isCustom(chatName: string) { return this.specs.get(chatName)?.kind === 'custom' }

  chatNameFor(name: string, namespace?: string) {
    if (!namespace)
      return name
    return this.namespaced.get(`${namespace}\u0000${name}`) ?? flattenNamespaceName(namespace, name)
  }

  private add(chatName: string, spec: ToolSpec, tool: Json) {
    if (!chatName.trim() || this.specs.has(chatName))
      return
    if (spec.namespace)
      this.namespaced.set(`${spec.namespace}\u0000${spec.name}`, chatName)
    this.specs.set(chatName, spec)
    this.chatTools.push(tool)
  }

  private addFunction(tool: Json, namespace?: string) {
    const name = toolName(tool)
    if (!name)
      return
    const chatName = namespace ? flattenNamespaceName(namespace, name) : name
    const chatTool = functionToolToChat(tool, chatName)
    if (chatTool)
      this.add(chatName, { kind: namespace ? 'namespace' : 'function', name, namespace }, chatTool)
  }

  private addCustom(tool: Json) {
    const name = toolName(tool)
    if (!name)
      return
    this.add(name, { kind: 'custom', name }, { type: 'function', function: { name, description: `Original tool definition:\n\`\`\`json\n${canonicalJson(tool)}\n\`\`\``, parameters: { type: 'object', properties: { [customInputField]: { type: 'string', description: customInputDescription } }, required: [customInputField] } } })
  }

  addResponseTool(tool: Json) {
    if (typeof tool === 'string')
      return this.addCustom({ type: 'custom', name: tool })
    if (!isObject(tool))
      return
    switch (tool.type) {
      case 'function': return this.addFunction(tool)
      case 'custom': return this.addCustom(tool)
      case 'tool_search': return this.add(toolSearchName, { kind: 'tool_search', name: toolSearchName }, { type: 'function', function: { name: toolSearchName, description: 'Search and load Codex tools, plugins, connectors, and MCP namespaces for the current task.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query for tools or connectors to load.' }, limit: { type: 'integer', description: 'Maximum number of tool groups to return.' } }, required: ['query'] } } })
      case 'namespace': {
        const namespace = str(tool.name)
        const children = Array.isArray(tool.tools) ? tool.tools : Array.isArray(tool.children) ? tool.children : undefined
        if (namespace && children) {
          for (const child of children) {
            if (child?.type === 'function')
              this.addFunction(child, namespace)
          }
        }
      }
    }
  }
}

/** `namespace__name`, shortened with a hash past Chat's 64-character limit. */
export function flattenNamespaceName(namespace: string, name: string) {
  const full = `${namespace}__${name}`
  if (Buffer.byteLength(full) <= chatToolNameMax)
    return full
  const suffix = `__${shortSha256(full)}`
  let prefix = ''
  for (const char of full) {
    if (Buffer.byteLength(prefix + char) > chatToolNameMax - suffix.length)
      break
    prefix += char
  }
  return `${prefix}${suffix}`
}

function toolName(tool: Json) {
  const name = str(tool?.function?.name) ?? str(tool?.name)
  return name?.trim() || undefined
}

/** Chat strictly wants `{type: 'object', …}` parameters. */
function normalizeParameters(parameters: Json) {
  const next = isObject(parameters) ? { ...parameters } : { type: 'object', properties: {} }
  if (next.type !== 'object')
    next.type = 'object'
  return next
}

function functionToolToChat(tool: Json, chatName: string) {
  if (tool?.type !== 'function')
    return undefined
  if (isObject(tool.function)) {
    const fn: Json = { ...tool.function, parameters: normalizeParameters(tool.function.parameters), name: chatName }
    if (tool.strict !== undefined && fn.strict === undefined)
      fn.strict = tool.strict
    return { type: 'function', function: fn }
  }
  const fn: Json = { name: chatName }
  // A missing description is left out: strict gateways reject `null`.
  if (tool.description !== undefined && tool.description !== null)
    fn.description = tool.description
  fn.parameters = normalizeParameters(tool.parameters)
  if (tool.strict !== undefined)
    fn.strict = tool.strict
  return { type: 'function', function: fn }
}

/** Tools from the request, including ones declared inside `input` (loaded tool groups, `additional_tools`). */
export function toolContextFrom(body: Json) {
  const context = new CodexToolContext()
  for (const tool of Array.isArray(body?.tools) ? body.tools : []) context.addResponseTool(tool)
  const collect = (value: Json) => {
    if (Array.isArray(value))
      return value.forEach(collect)
    if (!isObject(value))
      return
    if ((value.type === 'tool_search_output' || value.type === 'additional_tools') && Array.isArray(value.tools))
      value.tools.forEach((tool: Json) => context.addResponseTool(tool))
    Object.values(value).forEach(collect)
  }
  collect(body?.input)
  context.compaction = isCompactionRequest(body)
  return context
}

// Reasoning text, wherever the different upstreams and Codex put it (cc-switch's `codex_chat_common.rs`).

function detailsText(value: Json): string | undefined {
  if (typeof value === 'string')
    return value || undefined
  if (Array.isArray(value)) {
    const text = value.map(detailPartText).filter(Boolean).join('\n\n')
    return text || undefined
  }
  return isObject(value) ? detailPartText(value) : undefined
}
function detailPartText(value: Json): string | undefined {
  for (const key of ['text', 'content', 'summary']) {
    if (typeof value?.[key] === 'string' && value[key])
      return value[key]
  }
  if (Array.isArray(value?.parts)) {
    const text = value.parts.map(detailPartText).filter(Boolean).join('\n\n')
    return text || undefined
  }
}

/** `reasoning_content`, `reasoning`, `reasoning.{content,text,summary}` or `reasoning_details`. */
export function reasoningFieldText(value: Json): string | undefined {
  for (const key of ['reasoning_content', 'reasoning']) {
    if (typeof value?.[key] === 'string' && value[key])
      return value[key]
  }
  if (isObject(value?.reasoning)) {
    for (const key of ['content', 'text', 'summary']) {
      if (typeof value.reasoning[key] === 'string' && value.reasoning[key])
        return value.reasoning[key]
    }
  }
  return value?.reasoning_details !== undefined ? detailsText(value.reasoning_details) : undefined
}

/** A Responses `reasoning` item's text: its content, or its summary parts. */
function reasoningSummaryText(value: Json): string | undefined {
  for (const key of ['reasoning_content', 'content', 'text']) {
    if (typeof value?.[key] === 'string' && value[key])
      return value[key]
  }
  const summary = value?.summary
  if (typeof summary === 'string')
    return summary || undefined
  if (!Array.isArray(summary))
    return undefined
  const text = summary.map((part: Json) => str(part?.text) ?? str(part?.content) ?? str(part)).filter(Boolean).join('\n\n')
  return text || undefined
}

function appendReasoning(message: Json, reasoning: string) {
  const text = reasoning.trim()
  if (!text)
    return
  message.reasoning_content = typeof message.reasoning_content === 'string' && message.reasoning_content ? `${message.reasoning_content}\n\n${text}` : text
}

function copyExtraContent(target: Json, source: Json) {
  if (isObject(source?.extra_content) && Object.keys(source.extra_content).length)
    target.extra_content = source.extra_content
}

// Responses request → Chat request.

/** o1, o3, o4-mini…: they take `max_completion_tokens`. */
export const isOpenAiOSeries = (model: string) => /^o\d/.test(model)

/** Convert a Codex Responses request into a Chat Completions request for this provider. */
export function responsesToChat(body: Json, reasoning?: ChatReasoning): Json {
  const result: Json = {}
  const context = toolContextFrom(body)
  const model = str(body?.model) ?? ''
  if (body?.model !== undefined)
    result.model = body.model
  let messages: Json[] = []
  if (body?.instructions !== undefined) {
    const instructions = instructionText(body.instructions)
    if (instructions)
      messages.push({ role: 'system', content: instructions })
  }
  if (body?.input !== undefined)
    appendInput(body.input, messages, context)
  preserveInvalidToolCallsAsText(messages)
  // DeepSeek strictly checks that tool results follow their call; repair only for DeepSeek, other providers' caches
  // depend on the history staying as it was.
  if (isDeepSeekModel(model))
    coalesceReplayedToolTurns(messages)
  backfillToolCallReasoning(messages)
  messages = collapseSystemToHead(messages)
  result.messages = messages

  if (body?.max_output_tokens !== undefined)
    result[isOpenAiOSeries(model) ? 'max_completion_tokens' : 'max_tokens'] = body.max_output_tokens
  if (body?.max_tokens !== undefined)
    result.max_tokens = body.max_tokens
  if (body?.max_completion_tokens !== undefined)
    result.max_completion_tokens = body.max_completion_tokens
  for (const key of ['temperature', 'top_p', 'stream']) {
    if (body?.[key] !== undefined)
      result[key] = body[key]
  }
  applyReasoning(result, body, model, reasoning)
  // A compaction turn only wants a summary: no tools, no structured output.
  if (context.chatTools.length && !context.compaction)
    result.tools = context.chatTools
  if (body?.tool_choice !== undefined)
    result.tool_choice = toolChoiceToChat(body.tool_choice, context)
  for (const key of passthroughFields) {
    if (context.compaction && key === 'response_format')
      continue
    if (body?.[key] !== undefined)
      result[key] = body[key]
  }
  // Strict gateways (vLLM, enterprise proxies) reject tool_choice or parallel_tool_calls without tools.
  if (!Array.isArray(result.tools) || !result.tools.length) {
    delete result.tool_choice
    delete result.parallel_tool_calls
  }
  injectIncludeUsage(result)
  return result
}

/** Chat upstreams only report usage in a stream when asked to. */
export function injectIncludeUsage(result: Json) {
  if (result.stream !== true)
    return
  result.stream_options = { ...(isObject(result.stream_options) ? result.stream_options : {}), include_usage: true }
}

/** Models that take `reasoning_effort` when the provider says nothing about reasoning: o-series, GPT-5+, Grok 4.5+. */
export function supportsReasoningEffort(model: string) {
  const name = model.toLowerCase()
  const grokMinor = /^grok-4\.(\d+)/.exec(name)?.[1]
  return isOpenAiOSeries(name) || /^gpt-[5-9]/.test(name) || (grokMinor !== undefined && Number(grokMinor) >= 5) || name.startsWith('grok-build-')
}

function reasoningRequested(body: Json): boolean | undefined {
  const effort = body?.reasoning?.effort
  if (typeof effort === 'string')
    return !['none', 'off', 'disabled'].includes(effort.trim().toLowerCase())
  return body?.reasoning === undefined ? undefined : body.reasoning !== null
}

const effortRank: Record<string, number> = { minimal: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5, ultra: 6 }

/** Codex's effort in the provider's own vocabulary (cc-switch's value modes); undefined means send none. */
export function mapEffort(effortInput: string, mode = 'passthrough', levels?: string[]): string | undefined {
  const effort = effortInput.trim().toLowerCase()
  if (['none', 'off', 'disabled'].includes(effort))
    return undefined
  switch (mode) {
    case 'deepseek': return ['max', 'xhigh', 'ultra'].includes(effort) ? 'max' : 'high'
    case 'low_high': return ['minimal', 'low'].includes(effort) ? 'low' : 'high'
    // OpenRouter has no `max`: clamp to its highest.
    case 'openrouter': return ['max', 'xhigh', 'ultra'].includes(effort) ? 'xhigh' : ['high', 'medium', 'low', 'minimal'].includes(effort) ? effort : undefined
    case 'zen': {
      const requested = effortRank[effort]
      if (!levels || requested === undefined)
        return undefined
      const ranked = levels.map(level => [effortRank[level.trim().toLowerCase()], level] as const).filter((entry): entry is readonly [number, string] => entry[0] !== undefined)
      const atLeast = ranked.filter(([rank]) => rank >= requested).sort(([a], [b]) => a - b)[0]
      return (atLeast ?? ranked.sort(([a], [b]) => b - a)[0])?.[1]
    }
    default: return effort in effortRank ? effort : undefined
  }
}

function applyReasoning(result: Json, body: Json, model: string, config?: ChatReasoning) {
  if (!config) {
    if (supportsReasoningEffort(model) && body?.reasoning?.effort !== undefined)
      result.reasoning_effort = body.reasoning.effort
    return
  }
  const supportsEffort = config.supportsEffort ?? false
  const supportsThinking = (config.supportsThinking ?? false) || supportsEffort
  const enabled = reasoningRequested(body)
  if (enabled === undefined)
    return
  if (supportsThinking) {
    const param = (config.thinkingParam ?? 'thinking').trim().toLowerCase()
    if (param === 'thinking')
      result.thinking = { type: enabled ? 'enabled' : 'disabled' }
    else if (param === 'enable_thinking')
      result.enable_thinking = enabled
    else if (param === 'reasoning_split')
      result.reasoning_split = enabled
  }
  const effortParam = (config.effortParam ?? 'reasoning_effort').trim().toLowerCase()
  if (!enabled) {
    // OpenRouter's object form can say "none" explicitly; some of its models think unless told not to.
    if (effortParam === 'reasoning.effort')
      result.reasoning = { effort: 'none' }
    return
  }
  if (!supportsEffort || typeof body?.reasoning?.effort !== 'string')
    return
  const mapped = mapEffort(body.reasoning.effort, config.effortValueMode, config.effortLevels)
  if (!mapped)
    return
  if (effortParam === 'reasoning_effort')
    result.reasoning_effort = mapped
  else if (effortParam === 'reasoning.effort')
    result.reasoning = { effort: mapped }
}

/** MiniMax accepts `system` only as the first message; merging them there is harmless for everyone else. */
function collapseSystemToHead(messages: Json[]) {
  const chunks: string[] = []
  const rest: Json[] = []
  for (const message of messages) {
    if (message.role === 'system' && typeof message.content === 'string') {
      if (message.content.trim())
        chunks.push(message.content)
      continue
    }
    rest.push(message)
  }
  return chunks.length ? [{ role: 'system', content: chunks.join('\n\n') }, ...rest] : rest
}

function instructionText(value: Json): string {
  if (typeof value === 'string')
    return value
  if (Array.isArray(value))
    return value.map((part: Json) => str(part?.text) ?? str(part)).filter(Boolean).join('\n\n')
  return ''
}

function isDeepSeekModel(model: string) {
  const name = (model.split('/').at(-1) ?? '').toLowerCase()
  return name === 'deepseek' || name.startsWith('deepseek-')
}
const isToolResult = (item: Json) => ['function_call_output', 'custom_tool_call_output', 'tool_search_output'].includes(item?.type)

/** The state of one input-to-messages pass. */
interface Pass {
  messages: Json[]
  calls: Json[]
  media: Json[]
  reasoning?: string
  lastAssistant?: number
  known: Set<string>
  orphans: Json[]
  context: CodexToolContext
}

function appendInput(input: Json, messages: Json[], context: CodexToolContext) {
  const pass: Pass = { messages, calls: [], media: [], known: new Set(), orphans: [], context }
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input })
  }
  else if (Array.isArray(input)) {
    for (const item of input) {
      // Anything but a tool result ends a result run: orphans go out there, so `tool` messages stay adjacent.
      if (!isToolResult(item))
        flushOrphans(pass)
      appendItem(item, pass)
    }
  }
  else if (isObject(input)) {
    appendItem(input, pass)
  }
  flushOrphans(pass)
  flushToolMedia(messages, pass.media)
  flushCalls(pass)
  attachReasoningToPrevious(pass)
}

function appendItem(item: Json, pass: Pass): void {
  const { messages } = pass
  switch (item?.type) {
    case 'function_call':
    case 'custom_tool_call':
    case 'tool_search_call': {
      appendUniqueReasoning(pass, reasoningFieldText(item))
      const call = item.type === 'function_call' ? functionCallToChat(item, pass.context) : item.type === 'custom_tool_call' ? customCallToChat(item) : toolSearchCallToChat(item)
      copyExtraContent(call, item)
      if (call.id)
        pass.known.add(call.id)
      pass.calls.push(call)
      return
    }
    case 'function_call_output': {
      const callId = str(item.call_id) ?? ''
      if (!callId || !pass.known.has(callId)) {
        pass.orphans.push(item)
        return
      }
      flushCalls(pass)
      const plan = item.output !== undefined ? planToolOutputMedia(item.output) : undefined
      let content: string
      if (plan) {
        queueToolMedia(pass.media, callId, plan.media)
        content = plan.content
      }
      else {
        content = typeof item.output === 'string' ? canonicalizeIfJson(item.output) : item.output === undefined ? '' : canonicalJson(item.output)
      }
      messages.push({ role: 'tool', tool_call_id: callId, content })
      return
    }
    case 'custom_tool_call_output':
    case 'tool_search_output': {
      const callId = str(item.call_id) ?? ''
      if (!callId || !pass.known.has(callId)) {
        pass.orphans.push(item)
        return
      }
      flushCalls(pass)
      let content = canonicalJson(item)
      if (item.output !== undefined) {
        const media: Json[] = []
        const [output, moved] = stripToolMedia(structuredClone(item.output), media)
        if (moved) {
          queueToolMedia(pass.media, callId, media)
          content = canonicalJson({ ...item, output })
        }
      }
      messages.push({ role: 'tool', tool_call_id: callId, content })
      return
    }
    case 'reasoning':
      // Reasoning attaches forward, to the message or call batch after it; leftovers at a boundary go backward.
      appendPendingReasoning(pass, reasoningSummaryText(item))
      return
    case 'compaction_trigger':
      return appendItem(userMessageItem(compactPrompt), pass)
    case 'compaction':
    case 'compaction_summary':
    case 'context_compaction': {
      const text = compactionReplayText(item)
      if (text)
        appendItem(userMessageItem(text), pass)
      return
    }
    // Carries tool declarations (collected above), not a message: a `content: null` message would be rejected.
    case 'additional_tools':
      return
    case 'input_text':
    case 'input_image':
    case 'input_file':
    case 'input_audio': {
      flushCalls(pass)
      flushToolMedia(messages, pass.media)
      const role = chatRole(str(item.role) ?? 'user')
      const message: Json = { role, content: contentToChat([item]) }
      if (role === 'assistant')
        attachReasoning(message, pass)
      else attachReasoningToPrevious(pass)
      updateLastAssistant(pass, message)
      messages.push(message)
      return
    }
    default: {
      if (item?.role !== undefined || item?.content !== undefined) {
        flushCalls(pass)
        flushToolMedia(messages, pass.media)
        const message = messageItemToChat(item, pass)
        updateLastAssistant(pass, message)
        messages.push(message)
      }
      // An inert item used to close a pending call batch; it must not split a batch whose media still waits.
      else if (!pass.media.length) {
        flushCalls(pass)
      }
    }
  }
}

function flushOrphans(pass: Pass) {
  for (const item of pass.orphans.splice(0)) {
    const callId = str(item.call_id) ?? ''
    let body: string
    let media: Json[] = []
    const plan = item.output !== undefined ? planToolOutputMedia(item.output) : undefined
    if (plan) {
      body = plan.content
      media = plan.media
    }
    else {
      body = typeof item.output === 'string' ? canonicalizeIfJson(item.output) : item.output === undefined ? '' : canonicalJson(item.output)
    }
    const text = `${callId ? `${orphanMarker} (call_id: ${callId})` : orphanMarker}\n${body}`
    pass.messages.push({ role: 'user', content: media.length ? [{ type: 'text', text }, ...media] : text })
  }
}

function flushCalls(pass: Pass) {
  if (!pass.calls.length)
    return
  // A commentary message and the calls after it are one model turn: keep them on one assistant message, or Chat
  // models learn to stop after a progress update.
  const last = pass.messages.at(-1)
  if (last?.role === 'assistant' && !(Array.isArray(last.tool_calls) && last.tool_calls.length)) {
    last.tool_calls = pass.calls.splice(0)
    attachReasoningUnique(last, pass)
    pass.lastAssistant = pass.messages.length - 1
    return
  }
  flushToolMedia(pass.messages, pass.media)
  const message: Json = { role: 'assistant', content: null, tool_calls: pass.calls.splice(0) }
  attachReasoning(message, pass)
  pass.lastAssistant = pass.messages.length
  pass.messages.push(message)
}

function messageItemToChat(item: Json, pass: Pass) {
  const role = chatRole(str(item.role) ?? 'user')
  const message: Json = { role, content: item.content !== undefined ? contentToChat(item.content) : null }
  if (role === 'assistant') {
    appendPendingReasoning(pass, reasoningFieldText(item))
    attachReasoning(message, pass)
  }
  else {
    attachReasoningToPrevious(pass)
  }
  return message
}

function chatRole(role: string) {
  if (role === 'system' || role === 'developer')
    return 'system'
  if (role === 'assistant' || role === 'tool')
    return role
  return 'user'
}

function updateLastAssistant(pass: Pass, message: Json) {
  if (message.role === 'assistant')
    pass.lastAssistant = pass.messages.length
  else if (message.role !== 'tool')
    pass.lastAssistant = undefined
}

function appendPendingReasoning(pass: Pass, reasoning?: string) {
  const text = reasoning?.trim()
  if (text)
    pass.reasoning = pass.reasoning ? `${pass.reasoning}\n\n${text}` : text
}

function appendUniqueReasoning(pass: Pass, reasoning?: string) {
  const text = reasoning?.trim()
  if (!text || pass.reasoning?.includes(text))
    return
  pass.reasoning = pass.reasoning ? `${pass.reasoning}\n\n${text}` : text
}

function attachReasoning(message: Json, pass: Pass) {
  const reasoning = pass.reasoning
  pass.reasoning = undefined
  if (reasoning?.trim())
    appendReasoning(message, reasoning)
}

/** Attach pending reasoning without repeating segments the message already has. */
function attachReasoningUnique(message: Json, pass: Pass) {
  const reasoning = pass.reasoning
  pass.reasoning = undefined
  mergeReasoningUnique(message, reasoning)
}

function mergeReasoningUnique(message: Json, reasoningInput?: string) {
  const reasoning = reasoningInput?.trim()
  if (!reasoning)
    return
  const existing = (str(message.reasoning_content) ?? '').split('\n\n').map(part => part.trim()).filter(Boolean)
  const missing = reasoning.split('\n\n').map(part => part.trim()).filter(part => part && !existing.includes(part))
  if (missing.length)
    message.reasoning_content = [...existing, ...missing].join('\n\n')
}

/** Only at a turn boundary or the end of input: leftover reasoning goes to the previous assistant, never forward. */
function attachReasoningToPrevious(pass: Pass) {
  const reasoning = pass.reasoning?.trim()
  pass.reasoning = undefined
  if (!reasoning || pass.lastAssistant === undefined)
    return
  const message = pass.messages[pass.lastAssistant]
  if (message?.role === 'assistant')
    appendReasoning(message, reasoning)
}

/** Thinking models (Kimi, DeepSeek) want reasoning on every assistant tool-call message; a placeholder when lost. */
function backfillToolCallReasoning(messages: Json[]) {
  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length && !(typeof message.reasoning_content === 'string' && message.reasoning_content.trim()))
      message.reasoning_content = 'tool call'
  }
}

/**
 * Responses can replay assistant text before all of a turn's tool results; Chat (DeepSeek strictly) needs the
 * results right after the one assistant message that called them. Keep replayed content on that message.
 */
function coalesceReplayedToolTurns(messages: Json[]) {
  const out: Json[] = []
  let open: number | undefined
  const pending = new Set<string>()
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        if (call?.id)
          pending.add(call.id)
      }
      if (open !== undefined) {
        const target = out[open]
        mergeAssistantContent(target, message.content)
        mergeReasoningUnique(target, str(message.reasoning_content))
        if (Array.isArray(message.tool_calls))
          target.tool_calls.push(...message.tool_calls)
        continue
      }
      if (pending.size)
        open = out.length
    }
    else if (message.role === 'tool') {
      if (typeof message.tool_call_id === 'string')
        pending.delete(message.tool_call_id)
      if (!pending.size)
        open = undefined
    }
    else {
      open = undefined
      pending.clear()
    }
    out.push(message)
  }
  messages.splice(0, messages.length, ...out)
}

function mergeAssistantContent(target: Json, content: Json) {
  const empty = (value: Json) => value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)
  if (empty(content))
    return
  if (empty(target.content)) {
    target.content = content
    return
  }
  if (typeof target.content === 'string' && typeof content === 'string') {
    target.content = `${target.content}\n${content}`
    return
  }
  const parts = (value: Json) => Array.isArray(value) ? value : typeof value === 'string' ? [{ type: 'text', text: value }] : [value]
  target.content = [...parts(target.content), ...parts(content)]
}

/**
 * A replayed tool call whose arguments aren't a JSON object would be rejected upstream; keep it, and its result, as
 * plain context on the assistant message instead.
 */
export function preserveInvalidToolCallsAsText(messages: Json[]) {
  let recovered = 0
  const out: Json[] = []
  const owners = new Map<string, number>()
  const argumentsAreObject = (value: Json) => {
    if (isObject(value))
      return true
    if (typeof value !== 'string')
      return false
    try { return isObject(JSON.parse(value)) }
    catch { return false }
  }
  const contextText = (value: Json) => typeof value === 'string' ? value : value === undefined ? '<missing>' : JSON.stringify(value)
  const appendContext = (message: Json, text: string) => {
    if (typeof message.content === 'string')
      message.content = message.content ? `${message.content}\n\n${text}` : text
    else if (Array.isArray(message.content))
      message.content.push({ type: 'text', text })
    else message.content = text
  }
  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      const notes: string[] = []
      message.tool_calls = message.tool_calls.filter((call: Json) => {
        const id = str(call?.id)
        if (id)
          owners.delete(id)
        if (call?.type !== 'function' || argumentsAreObject(call.function?.arguments))
          return true
        if (id)
          owners.set(id, out.length)
        notes.push(`[Historical tool call with invalid arguments; context only, not a new tool invocation]\nname: ${str(call.function?.name) ?? '<unknown>'}\ncall_id: ${id ?? '<missing>'}\narguments: ${contextText(call.function?.arguments)}`)
        recovered++
        return false
      })
      if (notes.length) {
        if (!message.tool_calls.length)
          delete message.tool_calls
        for (const note of notes) appendContext(message, note)
      }
    }
    else if (message.role === 'tool' && typeof message.tool_call_id === 'string' && owners.has(message.tool_call_id)) {
      appendContext(out[owners.get(message.tool_call_id)!], `[Historical tool result for invalid call ${message.tool_call_id}; context only]\n${contextText(message.content)}`)
      continue
    }
    out.push(message)
  }
  messages.splice(0, messages.length, ...out)
  return recovered
}

/** Responses content parts as Chat content: a string when it's all text, parts otherwise. */
function contentToChat(content: Json): Json {
  if (content === null || typeof content === 'string' || !Array.isArray(content))
    return content
  const parts: Json[] = []
  let media = false
  for (const part of content) {
    switch (part?.type) {
      case 'input_text':
      case 'output_text':
      case 'text':
        if (typeof part.text === 'string' && part.text)
          parts.push({ type: 'text', text: part.text })
        break
      case 'refusal':
        if (typeof part.refusal === 'string' && part.refusal)
          parts.push({ type: 'text', text: part.refusal })
        break
      case 'input_image':
        if (part.image_url !== undefined) {
          parts.push({ type: 'image_url', image_url: isObject(part.image_url) ? part.image_url : { url: str(part.image_url) ?? '' } })
          media = true
        }
        break
      case 'input_file': {
        const file = chatFileFromInputFile(part)
        if (file) {
          parts.push({ type: 'file', file })
          media = true
        }
        break
      }
      case 'input_audio':
        if (part.input_audio !== undefined) {
          parts.push({ type: 'input_audio', input_audio: part.input_audio })
          media = true
        }
    }
  }
  return media ? parts : parts.map(part => part.text).join('\n')
}

function functionCallToChat(item: Json, context: CodexToolContext) {
  return { id: str(item.call_id) ?? str(item.id) ?? '', type: 'function', function: { name: context.chatNameFor(str(item.name) ?? '', str(item.namespace) || undefined), arguments: canonicalArguments(item.arguments) } } as Json
}

function customCallToChat(item: Json) {
  return { id: str(item.call_id) ?? str(item.id) ?? '', type: 'function', function: { name: str(item.name) ?? '', arguments: canonicalJson({ [customInputField]: item.input ?? '' }) } } as Json
}

function toolSearchCallToChat(item: Json) {
  return { id: str(item.call_id) ?? str(item.id) ?? '', type: 'function', function: { name: toolSearchName, arguments: item.arguments !== undefined ? canonicalJson(item.arguments) : '{}' } } as Json
}

function toolChoiceToChat(choice: Json, context: CodexToolContext) {
  if (isObject(choice)) {
    if (choice.type === 'function')
      return { type: 'function', function: { name: context.chatNameFor(str(choice.name) ?? '', str(choice.namespace) || undefined) } }
    if (choice.type === 'tool_search')
      return { type: 'function', function: { name: toolSearchName } }
    if (choice.type === 'custom')
      return { type: 'function', function: { name: str(choice.name) ?? '' } }
  }
  return choice
}

// Chat response → Responses response.

export const responseIdFromChatId = (id?: string) => !id ? 'resp_anna' : id.startsWith('resp_') ? id : `resp_${id}`
export const statusFromFinishReason = (reason?: string) => reason === 'length' ? 'incomplete' : 'completed'
export const toolCallItemId = (callId: string, chatName: string, context: CodexToolContext) => `${context.isCustom(chatName) ? 'ctc' : 'fc'}_${callId}`

/** A custom tool's raw input from the `{input: …}` arguments it was called with. */
export function customInputFromArguments(args: string) {
  if (!args.trim())
    return ''
  try {
    const parsed = JSON.parse(args)
    return isObject(parsed) && typeof parsed[customInputField] === 'string' ? parsed[customInputField] : args
  }
  catch { return args }
}

/** The Responses item for a Chat tool call, restored to Codex's own kind (function, namespace, custom, tool search). */
export function toolCallItem(itemId: string, status: string, callId: string, chatName: string, args: string, reasoning: string | undefined, context: CodexToolContext): Json {
  const spec = context.lookup(chatName)
  let item: Json
  if (spec?.kind === 'tool_search') {
    let parsed: Json = {}
    if (args.trim()) {
      try {
        parsed = JSON.parse(args)
        if (!isObject(parsed))
          parsed = { query: args }
      }
      catch { parsed = { query: args } }
    }
    item = { type: 'tool_search_call', call_id: callId, status, execution: 'client', arguments: parsed }
  }
  else if (spec?.kind === 'custom') {
    item = { id: itemId, type: 'custom_tool_call', status, call_id: callId, name: spec.name, input: customInputFromArguments(args) }
  }
  else {
    item = { id: itemId, type: 'function_call', status, call_id: callId, name: spec?.name ?? chatName, arguments: args }
    if (spec?.namespace)
      item.namespace = spec.namespace
  }
  if (reasoning?.trim())
    item.reasoning_content = reasoning.trim()
  return item
}

/** Chat usage as Responses usage; cache reads from wherever the upstream reports them (a stub 0 doesn't count). */
export function chatUsageToResponses(usage: Json) {
  if (!isObject(usage))
    return { input_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens: 0, total_tokens: 0, output_tokens_details: { reasoning_tokens: 0 } }
  const n = (value: Json) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined
  const nonzero = (value: Json) => n(value) || undefined
  const input = n(usage.prompt_tokens) ?? n(usage.input_tokens) ?? 0
  const output = n(usage.completion_tokens) ?? n(usage.output_tokens) ?? 0
  const result: Json = { input_tokens: input, output_tokens: output, total_tokens: n(usage.total_tokens) ?? input + output }
  const directRead = nonzero(usage.cache_read_input_tokens)
  const cached = directRead ?? nonzero(usage.prompt_tokens_details?.cached_tokens) ?? nonzero(usage.input_tokens_details?.cached_tokens) ?? nonzero(usage.prompt_cache_hit_tokens) ?? 0
  const write = n(usage.prompt_tokens_details?.cache_write_tokens) ?? n(usage.input_tokens_details?.cache_write_tokens) ?? n(usage.cache_creation_input_tokens) ?? 0
  result.input_tokens_details = cached || write ? { cached_tokens: cached, cache_write_tokens: write } : { cached_tokens: 0 }
  result.output_tokens_details = isObject(usage.completion_tokens_details) ? { reasoning_tokens: 0, ...usage.completion_tokens_details } : { reasoning_tokens: 0 }
  if (directRead !== undefined)
    result.cache_read_input_tokens = directRead
  if (write)
    result.cache_creation_input_tokens = write
  return result
}

function chatReasoningText(message: Json) {
  const field = reasoningFieldText(message)
  if (field)
    return field
  if (typeof message?.content === 'string') {
    const split = splitLeadingThink(message.content)
    if (split?.[0])
      return split[0]
  }
}

function chatMessageToOutput(message: Json, responseId: string) {
  const content: Json[] = []
  if (typeof message.content === 'string') {
    const text = splitLeadingThink(message.content)?.[1] ?? message.content
    if (text)
      content.push({ type: 'output_text', text, annotations: [] })
  }
  else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if ((part?.type === 'text' || part?.type === 'output_text') && typeof part.text === 'string' && part.text)
        content.push({ type: 'output_text', text: part.text, annotations: [] })
      else if (part?.type === 'refusal' && typeof part.refusal === 'string' && part.refusal)
        content.push({ type: 'refusal', refusal: part.refusal })
    }
  }
  if (typeof message.refusal === 'string' && message.refusal)
    content.push({ type: 'refusal', refusal: message.refusal })
  return content.length ? { id: `${responseId}_msg`, type: 'message', status: 'completed', role: 'assistant', content } : undefined
}

/** A non-streaming Chat completion as a Responses response. */
export function chatCompletionToResponse(body: Json, context = new CodexToolContext()) {
  const choice = Array.isArray(body?.choices) ? body.choices[0] : undefined
  if (!choice)
    throw new Error(Array.isArray(body?.choices) ? 'Empty choices in chat response' : 'No choices in chat response')
  const message = choice.message
  if (!message)
    throw new Error('No message in chat choice')
  const responseId = responseIdFromChatId(str(body.id))
  const finish = str(choice.finish_reason)
  const reasoning = chatReasoningText(message)
  const output: Json[] = []
  if (reasoning)
    output.push({ id: `rs_${responseId}`, type: 'reasoning', summary: [{ type: 'summary_text', text: reasoning }] })
  const text = chatMessageToOutput(message, responseId)
  if (text)
    output.push(text)
  let dropped = 0
  const calls: Json[] = []
  const toItem = (call: Json, index: number, fallbackId: string) => {
    const name = str(call?.function?.name ?? call?.name) ?? ''
    if (!name.trim()) {
      dropped++
      return
    }
    const callId = str(call.id) || fallbackId || `call_${index}`
    const item = toolCallItem(toolCallItemId(callId, name, context), 'completed', callId, name, canonicalArguments(call.function?.arguments ?? call.arguments), reasoning, context)
    copyExtraContent(item, call)
    calls.push(item)
  }
  if (Array.isArray(message.tool_calls))
    message.tool_calls.forEach((call: Json, index: number) => toItem(call, index, ''))
  else if (message.function_call)
    toItem({ function: message.function_call, id: message.function_call.id }, 0, 'call_0')
  // A turn whose only tool calls had no name would look complete and end Codex's loop silently: say so instead.
  if (statusFromFinishReason(finish) === 'completed' && dropped && !calls.length)
    throw new Error(`Upstream returned ${dropped} tool call(s) without a function name, leaving no usable tool call in this turn`)
  output.push(...calls)
  const response: Json = { id: responseId, object: 'response', created_at: typeof body.created === 'number' ? body.created : 0, status: statusFromFinishReason(finish), model: str(body.model) ?? '', output, usage: chatUsageToResponses(body.usage) }
  if (finish === 'length')
    response.incomplete_details = { reason: 'max_output_tokens' }
  return response
}

/** Any upstream error body as the Responses error shape Codex understands. */
export function chatErrorToResponseError(body: Json) {
  if (body === undefined || body === null)
    return { error: { message: 'Upstream returned an empty error response', type: 'upstream_error', code: null, param: null } }
  if (typeof body === 'string')
    return { error: { message: body, type: 'upstream_error', code: null, param: null } }
  const source = body.error ?? body
  const message = str(source?.message) ?? str(source?.detail) ?? str(source?.status_msg) ?? str(source?.base_resp?.status_msg) ?? str(source) ?? JSON.stringify(source)
  return { error: { message, type: str(source?.type) ?? 'upstream_error', code: source?.code ?? source?.base_resp?.status_code ?? null, param: source?.param ?? null } }
}

export { mediaMovedMarker }
