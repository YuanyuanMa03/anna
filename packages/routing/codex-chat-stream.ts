import type { CodexToolContext } from './codex-chat'
import type { Json } from './json'
import { chatUsageToResponses, customInputFromArguments, reasoningFieldText, responseIdFromChatId, statusFromFinishReason, toolCallItem, toolCallItemId } from './codex-chat'
import { compactionIncompleteReason, compactionOutputItem, summaryFromOutput } from './compaction'
import { InlineThinkSplitter } from './inline-think'
import { canonicalArguments, isObject, str } from './json'

/**
 * Chat Completions SSE → Responses SSE for Codex, ported from cc-switch's `streaming_codex_chat.rs` (MIT): reasoning,
 * text and tool calls become Responses output items with the events Codex expects, in order.
 */

const event = (name: string, data: Json) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
const outputItemAdded = (index: number, item: Json) => event('response.output_item.added', { type: 'response.output_item.added', output_index: index, item })
const outputItemDone = (index: number, item: Json) => event('response.output_item.done', { type: 'response.output_item.done', output_index: index, item })

interface Part { index?: number, id: string, text: string, added: boolean, done: boolean }
interface ToolState { index?: number, itemId: string, callId: string, name: string, args: string, reasoning: string, extra?: Json, added: boolean, done: boolean }

export class ChatToResponses {
  private started = false
  completed = false
  private responseId = 'resp_anna'
  private model = ''
  private createdAt = 0
  private nextIndex = 0
  private text: Part = { id: '', text: '', added: false, done: false }
  private reasoning: Part = { id: '', text: '', added: false, done: false }
  private think = new InlineThinkSplitter()
  private tools = new Map<number, ToolState>()
  private nextToolToAdd = 0
  private output: [number, Json][] = []
  private usage?: Json
  finishReason?: string
  private dropped = 0

  constructor(private context: CodexToolContext) {}

  private allocate() { return this.nextIndex++ }

  /** One parsed Chat chunk in, Responses SSE events out. */
  chunk(chunk: Json): string[] {
    const events: string[] = []
    if (typeof chunk?.id === 'string')
      this.responseId = responseIdFromChatId(chunk.id)
    if (typeof chunk?.model === 'string' && chunk.model)
      this.model = chunk.model
    if (typeof chunk?.created === 'number')
      this.createdAt = chunk.created
    events.push(...this.start())
    if (chunk?.usage !== undefined && chunk.usage !== null)
      this.usage = chatUsageToResponses(chunk.usage)
    const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : undefined
    if (!choice)
      return events
    const delta = choice.delta
    if (delta) {
      const reasoning = reasoningFieldText(delta)
      if (reasoning) {
        events.push(...this.reasoningDelta(reasoning))
        this.appendReasoningToTools(reasoning)
      }
      if (typeof delta.content === 'string' && delta.content)
        events.push(...this.emitThink(this.think.push(delta.content)))
      if (Array.isArray(delta.tool_calls)) {
        events.push(...this.emitThink(this.think.flush()))
        const reasoningForCall = this.reasoning.text.trim() || undefined
        events.push(...this.finalizeReasoning())
        for (const call of delta.tool_calls) events.push(...this.toolDelta(call, reasoningForCall))
      }
    }
    if (typeof choice.finish_reason === 'string')
      this.finishReason = choice.finish_reason
    return events
  }

  private emitThink([thinking, text]: [string | undefined, string | undefined]) {
    const events: string[] = []
    if (thinking)
      events.push(...this.reasoningDelta(thinking))
    if (text) {
      events.push(...this.finalizeReasoning())
      events.push(...this.textDelta(text))
    }
    return events
  }

  private base(status: string, output: Json[]) {
    return { id: this.responseId, object: 'response', created_at: this.createdAt, status, model: this.model, output, usage: this.usage ?? chatUsageToResponses(undefined) }
  }

  private start() {
    if (this.started)
      return []
    this.started = true
    const response = this.base('in_progress', [])
    return [event('response.created', { type: 'response.created', response }), event('response.in_progress', { type: 'response.in_progress', response })]
  }

  private reasoningDelta(delta: string) {
    const events: string[] = []
    if (!this.reasoning.added) {
      this.reasoning.index = this.allocate()
      this.reasoning.id = `rs_${this.responseId}`
      this.reasoning.added = true
      events.push(outputItemAdded(this.reasoning.index, { id: this.reasoning.id, type: 'reasoning', status: 'in_progress', summary: [] }))
      events.push(event('response.reasoning_summary_part.added', { type: 'response.reasoning_summary_part.added', item_id: this.reasoning.id, output_index: this.reasoning.index, summary_index: 0, part: { type: 'summary_text', text: '' } }))
    }
    this.reasoning.text += delta
    events.push(event('response.reasoning_summary_text.delta', { type: 'response.reasoning_summary_text.delta', item_id: this.reasoning.id, output_index: this.reasoning.index, summary_index: 0, delta }))
    return events
  }

  private textDelta(delta: string) {
    const events: string[] = []
    if (!this.text.added) {
      this.text.index = this.allocate()
      this.text.id = `${this.responseId}_msg`
      this.text.added = true
      events.push(outputItemAdded(this.text.index, { id: this.text.id, type: 'message', status: 'in_progress', role: 'assistant', content: [] }))
      events.push(event('response.content_part.added', { type: 'response.content_part.added', item_id: this.text.id, output_index: this.text.index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }))
    }
    this.text.text += delta
    events.push(event('response.output_text.delta', { type: 'response.output_text.delta', item_id: this.text.id, output_index: this.text.index, content_index: 0, delta }))
    return events
  }

  /**
   * A gateway that leaves out the required `index`: only a new, unseen id starts a new call; everything else belongs
   * to the last one (better to merge two parallel calls than to split one call's argument fragments).
   */
  private keyWithoutIndex(call: Json) {
    const keys = [...this.tools.keys()]
    const last = keys.length ? Math.max(...keys) : undefined
    const id = str(call?.id)
    if (!id)
      return last ?? 0
    for (const [key, state] of this.tools) {
      if (state.callId === id)
        return key
    }
    return last === undefined ? 0 : last + 1
  }

  private toolDelta(call: Json, reasoning?: string) {
    const key = typeof call?.index === 'number' ? call.index : this.keyWithoutIndex(call)
    const fn = call?.function ?? {}
    const args = str(fn.arguments) ?? ''
    let state = this.tools.get(key)
    if (!state) {
      state = { itemId: '', callId: '', name: '', args: '', reasoning: '', added: false, done: false }
      this.tools.set(key, state)
    }
    if (str(call?.id))
      state.callId = call.id
    if (str(fn.name))
      state.name = fn.name
    state.args += args
    if (isObject(call?.extra_content) && Object.keys(call.extra_content).length)
      state.extra = call.extra_content
    if (!state.reasoning && reasoning?.trim())
      state.reasoning = reasoning.trim()
    const events: string[] = []
    if (args && state.added && !this.context.isCustom(state.name))
      events.push(event('response.function_call_arguments.delta', { type: 'response.function_call_arguments.delta', item_id: state.itemId, output_index: state.index, delta: args }))
    events.push(...this.flushReadyTools())
    return events
  }

  /** Announce calls in Chat index order once they have an id and a name, so late fragments can't reorder them. */
  private flushReadyTools() {
    const events: string[] = []
    for (;;) {
      const state = this.tools.get(this.nextToolToAdd)
      if (!state)
        break
      if (state.added || state.done) {
        this.nextToolToAdd++
        continue
      }
      if (!state.callId || !state.name)
        break
      state.added = true
      state.index = this.allocate()
      state.itemId = toolCallItemId(state.callId, state.name, this.context)
      events.push(outputItemAdded(state.index, toolCallItem(state.itemId, 'in_progress', state.callId, state.name, '', state.reasoning, this.context)))
      if (state.args && !this.context.isCustom(state.name))
        events.push(event('response.function_call_arguments.delta', { type: 'response.function_call_arguments.delta', item_id: state.itemId, output_index: state.index, delta: state.args }))
      this.nextToolToAdd++
    }
    return events
  }

  private appendReasoningToTools(delta: string) {
    if (!delta.trim())
      return
    for (const state of this.tools.values()) {
      if (!state.done)
        state.reasoning = state.reasoning ? state.reasoning + delta : delta.trimStart()
    }
  }

  hasSubstantiveOutput() {
    return Boolean(this.text.text.trim() || this.reasoning.text.trim() || this.think.hasPendingContent() || this.output.length || [...this.tools.values()].some(state => state.added || state.callId.trim() || state.name.trim() || state.args.trim() || state.reasoning.trim()))
  }

  private finalizeReasoning() {
    if (!this.reasoning.added || this.reasoning.done)
      return []
    this.reasoning.done = true
    const { index, id, text } = this.reasoning
    const item = { id, type: 'reasoning', summary: [{ type: 'summary_text', text }] }
    this.output.push([index!, item])
    return [
      event('response.reasoning_summary_text.done', { type: 'response.reasoning_summary_text.done', item_id: id, output_index: index, summary_index: 0, text }),
      event('response.reasoning_summary_part.done', { type: 'response.reasoning_summary_part.done', item_id: id, output_index: index, summary_index: 0, part: { type: 'summary_text', text } }),
      outputItemDone(index!, item),
    ]
  }

  private finalizeText() {
    if (!this.text.added || this.text.done)
      return []
    this.text.done = true
    const { index, id, text } = this.text
    const item = { id, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }
    this.output.push([index!, item])
    return [
      event('response.output_text.done', { type: 'response.output_text.done', item_id: id, output_index: index, content_index: 0, text }),
      event('response.content_part.done', { type: 'response.content_part.done', item_id: id, output_index: index, content_index: 0, part: { type: 'output_text', text, annotations: [] } }),
      outputItemDone(index!, item),
    ]
  }

  private finalizeTools() {
    const events: string[] = []
    for (const [key, state] of [...this.tools.entries()].sort(([a], [b]) => a - b)) {
      if (state.done)
        continue
      // A call without a usable name can't reach any tool: drop it (and count it, see `finalize`).
      if (!state.name.trim()) {
        state.done = true
        this.dropped++
        continue
      }
      if (!state.added) {
        state.added = true
        state.callId ||= `call_${key}`
        state.index = this.allocate()
        state.itemId = toolCallItemId(state.callId, state.name, this.context)
        events.push(outputItemAdded(state.index, toolCallItem(state.itemId, 'in_progress', state.callId, state.name, '', state.reasoning, this.context)))
      }
      const args = canonicalArguments(state.args)
      const item = toolCallItem(state.itemId, 'completed', state.callId, state.name, args, state.reasoning, this.context)
      if (state.extra)
        item.extra_content = state.extra
      state.done = true
      this.output.push([state.index!, item])
      if (this.context.isCustom(state.name)) {
        const input = customInputFromArguments(args)
        if (input)
          events.push(event('response.custom_tool_call_input.delta', { type: 'response.custom_tool_call_input.delta', item_id: state.itemId, output_index: state.index, delta: input }))
        events.push(event('response.custom_tool_call_input.done', { type: 'response.custom_tool_call_input.done', item_id: state.itemId, output_index: state.index, input }))
      }
      else {
        events.push(event('response.function_call_arguments.done', { type: 'response.function_call_arguments.done', item_id: state.itemId, output_index: state.index, arguments: args }))
      }
      events.push(outputItemDone(state.index!, item))
    }
    return events
  }

  private outputItems() { return [...this.output].sort(([a], [b]) => a - b).map(([, item]) => item) }

  failed(message: string, type?: string) {
    this.completed = true
    const response: Json = { ...this.base('failed', this.outputItems()), error: { message, ...(type ? { type } : {}) } }
    return event('response.failed', { type: 'response.failed', response })
  }

  /** Close everything and end the response (completed, incomplete or failed). */
  finalize(): string[] {
    if (this.completed)
      return []
    const events = [...this.start(), ...this.emitThink(this.think.flush()), ...this.finalizeReasoning(), ...this.finalizeText(), ...this.finalizeTools()]
    if (this.context.compaction)
      return this.finishCompaction(events)
    const status = statusFromFinishReason(this.finishReason)
    // A completed turn whose only tool calls had no name would end Codex's loop silently: say so instead.
    if (status === 'completed' && this.dropped && !this.outputItems().some(item => ['function_call', 'custom_tool_call', 'tool_search_call'].includes(item.type))) {
      events.push(this.failed(`Upstream returned ${this.dropped} tool call(s) without a function name, leaving no usable tool call in this turn`, 'upstream_tool_call_dropped'))
      return events
    }
    const response: Json = this.base(status, this.outputItems())
    if (status === 'incomplete')
      response.incomplete_details = { reason: 'max_output_tokens' }
    events.push(event('response.completed', { type: 'response.completed', response }))
    this.completed = true
    return events
  }

  /** A remote compaction turn hands back one compaction item; a cut-off or empty summary is an error, never kept. */
  private finishCompaction(events: string[]) {
    const reason = compactionIncompleteReason(this.finishReason)
    if (reason) {
      const response: Json = { ...this.base('incomplete', this.outputItems()), incomplete_details: { reason } }
      events.push(event('response.incomplete', { type: 'response.incomplete', response }))
      this.completed = true
      return events
    }
    const summary = summaryFromOutput(this.outputItems())
    if (!summary) {
      events.push(this.failed('Upstream returned no summary text for the compaction turn', 'compaction_summary_empty'))
      return events
    }
    const item = compactionOutputItem(summary)
    const index = this.allocate()
    events.push(outputItemDone(index, item))
    this.output.push([index, item])
    events.push(event('response.completed', { type: 'response.completed', response: this.base('completed', this.outputItems()) }))
    this.completed = true
    return events
  }
}

/** Split an SSE text buffer into complete blocks, leaving the rest. */
export function takeSseBlocks(buffer: string): [string[], string] {
  const blocks: string[] = []
  let rest = buffer.replace(/\r\n/g, '\n')
  for (let index = rest.indexOf('\n\n'); index >= 0; index = rest.indexOf('\n\n')) {
    blocks.push(rest.slice(0, index))
    rest = rest.slice(index + 2)
  }
  return [blocks, rest]
}

function chatSseError(value: Json): [string, string | undefined] {
  const error = value?.error ?? value
  const message = typeof error === 'string' ? error : str(error?.message) ?? str(error?.detail) ?? JSON.stringify(error)
  return [message, str(error?.type) ?? str(error?.code)]
}

/** Convert a Chat Completions SSE byte stream into Responses SSE text, event by event. */
export async function* chatStreamToResponses(stream: AsyncIterable<Uint8Array>, context: CodexToolContext): AsyncGenerator<string> {
  const state = new ChatToResponses(context)
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for await (const bytes of stream) {
      buffer += decoder.decode(bytes, { stream: true })
      const [blocks, rest] = takeSseBlocks(buffer)
      buffer = rest
      for (const block of blocks) {
        let name: string | undefined
        const data: string[] = []
        for (const line of block.split('\n')) {
          if (line.startsWith('event:'))
            name = line.slice(6).trim()
          else if (line.startsWith('data:'))
            data.push(line.slice(5).replace(/^ /, ''))
        }
        if (!data.length)
          continue
        const text = data.join('\n')
        if (text.trim() === '[DONE]') {
          // [DONE] is terminal, failed or incomplete included.
          yield* state.finalize()
          return
        }
        let chunk: Json
        try { chunk = JSON.parse(text) }
        catch { continue }
        if (name === 'error' || chunk?.error !== undefined) {
          const [message, type] = chatSseError(chunk)
          yield state.failed(message, type)
          return
        }
        yield* state.chunk(chunk)
      }
    }
  }
  catch (error) {
    yield state.failed(`Stream error: ${error instanceof Error ? error.message : String(error)}`, 'stream_error')
    return
  }
  if (state.completed || state.finishReason) {
    yield* state.finalize()
  }
  else if (state.hasSubstantiveOutput()) {
    // The upstream stopped without a finish reason: what arrived is cut off, not complete.
    state.finishReason = 'length'
    yield* state.finalize()
  }
  else {
    yield state.failed('Upstream Chat Completions stream ended before sending finish_reason', 'stream_truncated')
  }
}
