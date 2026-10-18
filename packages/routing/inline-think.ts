/**
 * Some Chat upstreams put their thinking inline, as a leading `<think>…</think>` (or `<thinking>`) block in the
 * content. Ported from cc-switch's `inline_think.rs`: the block becomes reasoning, the rest stays the answer.
 */
const pairs: [string, string][] = [['<think>', '</think>'], ['<thinking>', '</thinking>']]
const separators = /^[\r\n]+/
const trailingSeparators = /[\r\n]+$/

function stripOpenTag(text: string) {
  const after = text.trimStart()
  for (const [open] of pairs) {
    if (after.startsWith(open))
      return after.slice(open.length)
  }
}

function findCloseTag(text: string): [number, string] | undefined {
  let best: [number, string] | undefined
  for (const [, close] of pairs) {
    const index = text.indexOf(close)
    if (index >= 0 && (!best || index < best[0]))
      best = [index, close]
  }
  return best
}

/** `[thinking, answer]` when the text starts with a closed think block. */
export function splitLeadingThink(text: string): [string, string] | undefined {
  const body = stripOpenTag(text)
  if (body === undefined)
    return undefined
  const close = findCloseTag(body)
  if (!close)
    return undefined
  return [body.slice(0, close[0]).replace(separators, '').replace(trailingSeparators, ''), body.slice(close[0] + close[1].length).replace(separators, '')]
}

const nonEmpty = (text: string) => text || undefined

/** The streaming version: feed content deltas, get `[thinking, text]` pieces as soon as they are certain. */
export class InlineThinkSplitter {
  private mode: 'detecting' | 'reasoning' | 'text' = 'detecting'
  private buffer = ''
  private stripSeparator = false

  push(delta: string): [string | undefined, string | undefined] {
    if (this.mode === 'text')
      return [undefined, this.pushText(delta)]
    this.buffer += delta
    if (this.mode === 'reasoning')
      return this.drainReasoning()
    const trimmed = this.buffer.trimStart()
    if (!trimmed)
      return [undefined, undefined]
    if (pairs.some(([open]) => trimmed.startsWith(open))) {
      this.mode = 'reasoning'
      this.stripSeparator = true
      this.buffer = stripOpenTag(this.buffer) ?? ''
      return this.drainReasoning()
    }
    if (pairs.some(([open]) => open.startsWith(trimmed)))
      return [undefined, undefined]
    this.mode = 'text'
    const text = this.buffer
    this.buffer = ''
    return [undefined, nonEmpty(text)]
  }

  private pushText(delta: string) {
    if (!this.stripSeparator)
      return nonEmpty(delta)
    const rest = delta.replace(separators, '')
    if (!rest)
      return undefined
    this.stripSeparator = false
    return rest
  }

  private drainReasoning(): [string | undefined, string | undefined] {
    if (this.stripSeparator) {
      this.buffer = this.buffer.replace(separators, '')
      if (!this.buffer)
        return [undefined, undefined]
      this.stripSeparator = false
    }
    const close = findCloseTag(this.buffer)
    if (close) {
      const buffered = this.buffer
      this.buffer = ''
      this.mode = 'text'
      this.stripSeparator = true
      return [nonEmpty(buffered.slice(0, close[0]).replace(trailingSeparators, '')), this.pushText(buffered.slice(close[0] + close[1].length))]
    }
    // Hold back what might be the start of a closing tag, and trailing newlines before it.
    let partial = 0
    for (const [, closeTag] of pairs) {
      for (let length = closeTag.length - 1; length > 0; length--) {
        if (this.buffer.endsWith(closeTag.slice(0, length))) {
          partial = Math.max(partial, length)
          break
        }
      }
    }
    const body = this.buffer.slice(0, this.buffer.length - partial)
    const holdback = this.buffer.length - body.replace(trailingSeparators, '').length
    const thinking = this.buffer.slice(0, this.buffer.length - holdback)
    this.buffer = this.buffer.slice(this.buffer.length - holdback)
    return [nonEmpty(thinking), undefined]
  }

  flush(): [string | undefined, string | undefined] {
    const buffered = this.buffer
    const wasReasoning = this.mode === 'reasoning'
    this.buffer = ''
    this.mode = 'text'
    this.stripSeparator = false
    return wasReasoning ? [nonEmpty(buffered), undefined] : [undefined, nonEmpty(buffered)]
  }

  hasPendingContent() { return this.buffer.trim().length > 0 }
}
