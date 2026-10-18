import type { Json } from './json'
import { anthropicUsage, stopReasonOf } from './claude-chat'
import { reasoningFieldText } from './codex-chat'
import { takeSseBlocks } from './codex-chat-stream'
import { InlineThinkSplitter } from './inline-think'
import { str } from './json'

/**
 * Chat Completions SSE → Anthropic Messages SSE for Claude Code, ported from cc-switch's `streaming.rs` (MIT).
 * Every content block that starts also stops, there is exactly one `message_delta` (with the final usage) and one
 * `message_stop`, and a stream that breaks off never pretends to have finished.
 */

const event = (data: Json) => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`
/** A tool call whose arguments are this much unbroken whitespace is a known runaway (Copilot); it is cut off. */
const runawayWhitespace = 500

interface ToolBlock { index: number, id: string, name: string, started: boolean, pending: string, whitespace: number, aborted: boolean }

export class ChatToAnthropic {
  private id?: string
  private model?: string
  private nextIndex = 0
  private started = false
  /** A finish reason was handled; later ones only update its usage. */
  private finished = false
  private pending?: { stopReason?: string, usage?: Json }
  private latestUsage?: Json
  private currentType?: 'thinking' | 'text'
  private currentIndex?: number
  private think = new InlineThinkSplitter()
  private tools = new Map<number, ToolBlock>()
  private toolIds = new Map<string, number>()
  private openTools = new Set<number>()

  private block(type: 'thinking' | 'text', delta: string): string[] {
    const events: string[] = []
    if (this.currentType !== type) {
      if (this.currentIndex !== undefined)
        events.push(event({ type: 'content_block_stop', index: this.currentIndex }))
      const index = this.nextIndex++
      events.push(event({ type: 'content_block_start', index, content_block: type === 'thinking' ? { type: 'thinking', thinking: '' } : { type: 'text', text: '' } }))
      this.currentType = type
      this.currentIndex = index
    }
    events.push(event({ type: 'content_block_delta', index: this.currentIndex, delta: type === 'thinking' ? { type: 'thinking_delta', thinking: delta } : { type: 'text_delta', text: delta } }))
    return events
  }

  private pieces([thinking, text]: [string | undefined, string | undefined]) {
    return [...(thinking ? this.block('thinking', thinking) : []), ...(text ? this.block('text', text) : [])]
  }

  private closeCurrent(): string[] {
    const index = this.currentIndex
    this.currentIndex = undefined
    this.currentType = undefined
    return index === undefined ? [] : [event({ type: 'content_block_stop', index })]
  }

  private closeTools(): string[] {
    const events = [...this.openTools].sort((a, b) => a - b).map(index => event({ type: 'content_block_stop', index }))
    this.openTools.clear()
    return events
  }

  private messageEnd(): string[] {
    const { stopReason, usage } = this.pending!
    this.pending = undefined
    return [event({ type: 'message_delta', delta: { stop_reason: stopReason ?? null, stop_sequence: null }, usage: usage ?? { input_tokens: 0, output_tokens: 0 } }), event({ type: 'message_stop' })]
  }

  /** The tool call a delta belongs to: by index, or (for providers that leave it out) by id, else the last one. */
  private toolIndexOf(call: Json): number {
    if (typeof call?.index === 'number')
      return call.index
    const id = str(call?.id)
    if (id && this.toolIds.has(id))
      return this.toolIds.get(id)!
    if (id || !this.tools.size)
      return this.tools.size ? Math.max(...this.tools.keys()) + 1 : 0
    return Math.max(...this.tools.keys())
  }

  private toolDeltas(calls: Json[]): string[] {
    // Held-back text goes out, and its block closes, before a tool block opens.
    const events = [...this.pieces(this.think.flush()), ...this.closeCurrent()]
    for (const call of calls) {
      const key = this.toolIndexOf(call)
      let state = this.tools.get(key)
      if (!state) {
        state = { index: this.nextIndex++, id: '', name: '', started: false, pending: '', whitespace: 0, aborted: false }
        this.tools.set(key, state)
      }
      if (state.aborted)
        continue
      // Continuation deltas may carry an empty id or name; they don't erase the call's identity.
      if (str(call?.id))
        state.id = call.id
      if (str(call?.function?.name))
        state.name = call.function.name
      if (state.id)
        this.toolIds.set(state.id, key)
      const start = !state.started && Boolean(state.id) && Boolean(state.name)
      if (start) {
        state.started = true
        events.push(event({ type: 'content_block_start', index: state.index, content_block: { type: 'tool_use', id: state.id, name: state.name, input: {} } }))
        this.openTools.add(state.index)
        if (state.pending) {
          events.push(event({ type: 'content_block_delta', index: state.index, delta: { type: 'input_json_delta', partial_json: state.pending } }))
          state.pending = ''
        }
      }
      const args = str(call?.function?.arguments)
      if (args === undefined)
        continue
      for (const char of args) state.whitespace = /\s/.test(char) ? state.whitespace + 1 : 0
      if (state.whitespace >= runawayWhitespace)
        state.aborted = true
      else if (state.started && args)
        events.push(event({ type: 'content_block_delta', index: state.index, delta: { type: 'input_json_delta', partial_json: args } }))
      else
        state.pending += args
    }
    return events
  }

  private finish(reason: string, usage?: Json): string[] {
    const events = [...this.pieces(this.think.flush()), ...this.closeCurrent()]
    // Calls whose id or name never arrived still start, so their arguments aren't lost.
    const late = [...this.tools.entries()].filter(([, state]) => !state.started && (state.pending || state.id || state.name)).sort(([, a], [, b]) => a.index - b.index)
    for (const [key, state] of late) {
      state.started = true
      events.push(event({ type: 'content_block_start', index: state.index, content_block: { type: 'tool_use', id: state.id || `tool_call_${key}`, name: state.name || 'unknown_tool', input: {} } }))
      this.openTools.add(state.index)
      if (state.pending) {
        events.push(event({ type: 'content_block_delta', index: state.index, delta: { type: 'input_json_delta', partial_json: state.pending } }))
        state.pending = ''
      }
    }
    events.push(...this.closeTools())
    // Held until [DONE] or the end of the stream, so it carries the final usage and is sent once.
    this.pending = { stopReason: stopReasonOf(reason), usage }
    return events
  }

  chunk(chunk: Json): string[] {
    if (!this.id && str(chunk?.id))
      this.id = chunk.id
    if (!this.model && str(chunk?.model))
      this.model = chunk.model
    const usage = chunk?.usage ? anthropicUsage(chunk.usage) : undefined
    if (usage) {
      this.latestUsage = usage
      if (this.pending)
        this.pending.usage = usage
    }
    const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : undefined
    if (!choice)
      return []
    const events: string[] = []
    if (!this.started) {
      this.started = true
      events.push(event({ type: 'message_start', message: { id: this.id ?? '', type: 'message', role: 'assistant', content: [], model: this.model ?? '', stop_reason: null, stop_sequence: null, usage: usage ? { ...usage, output_tokens: 0 } : { input_tokens: 0, output_tokens: 0 } } }))
    }
    const delta = choice.delta ?? {}
    const reasoning = reasoningFieldText(delta)
    if (reasoning)
      events.push(...this.block('thinking', reasoning))
    if (typeof delta.content === 'string' && delta.content)
      events.push(...this.pieces(this.think.push(delta.content)))
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length)
      events.push(...this.toolDeltas(delta.tool_calls))
    const reason = str(choice.finish_reason)
    if (reason) {
      if (this.finished) {
        if (this.pending && (usage ?? this.latestUsage))
          this.pending.usage = usage ?? this.latestUsage
      }
      else {
        this.finished = true
        events.push(...this.finish(reason, usage ?? this.latestUsage))
      }
    }
    return events
  }

  /** `[DONE]`: close whatever is open, then the one message_delta and message_stop. */
  done(): string[] {
    const events = [...this.pieces(this.think.flush()), ...this.closeCurrent(), ...this.closeTools()]
    if (this.pending)
      return [...events, ...this.messageEnd()]
    return [...events, event({ type: 'message_stop' })]
  }

  /** The stream ended without `[DONE]`: finished only if a finish reason came; a cut-off stream gets no success events. */
  end(): string[] {
    const events = this.pieces(this.think.flush())
    if (!this.pending)
      return events
    return [...events, ...this.closeCurrent(), ...this.closeTools(), ...this.messageEnd()]
  }

  /** The upstream failed: what arrived is sent, then an error event and nothing that looks like success. */
  error(message: string, type = 'api_error'): string[] {
    return [...this.pieces(this.think.flush()), event({ type: 'error', error: { type, message } })]
  }
}

const anthropicErrorTypes = new Set(['invalid_request_error', 'authentication_error', 'billing_error', 'permission_error', 'not_found_error', 'request_too_large', 'rate_limit_error', 'api_error', 'overloaded_error'])

/** Convert a Chat Completions SSE byte stream into Anthropic Messages SSE text, event by event. */
export async function* chatStreamToAnthropic(stream: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const state = new ChatToAnthropic()
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
          // [DONE] is terminal: nothing after it is read.
          yield* state.done()
          return
        }
        let chunk: Json
        try { chunk = JSON.parse(text) }
        catch { continue }
        // An error mid-stream is passed on as one (cc-switch drops it, and the turn then just stops).
        if (name === 'error' || chunk?.error !== undefined) {
          const error = chunk?.error ?? chunk
          const type = str(error?.type)
          yield* state.error(typeof error === 'string' ? error : str(error?.message) ?? JSON.stringify(error), type && anthropicErrorTypes.has(type) ? type : 'api_error')
          return
        }
        yield* state.chunk(chunk)
      }
    }
  }
  catch (error) {
    yield* state.error(`Stream error: ${error instanceof Error ? error.message : String(error)}`, 'api_error')
    return
  }
  yield* state.end()
}
