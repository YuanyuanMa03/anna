import type { Json } from './json'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

/**
 * Codex's remote compaction through a Chat upstream, ported from cc-switch's `codex_compaction.rs`: the request's
 * `compaction_trigger` becomes a summarization prompt, the summary comes back as a `compaction` item whose
 * `encrypted_content` is Anna's own envelope, and that item replays as readable text in later requests.
 */
const prefix = 'anna-compaction-v1:'
/** cc-switch's envelope, so a session started under cc-switch keeps its summary. */
const ccSwitchPrefix = 'ccswitch-compaction-v1:'

export const compactPrompt = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.
`

export const summaryPrefix = 'Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:'

export const opaqueCompactionNote = '[earlier conversation was compacted; the summary is stored in a format this model cannot read]'

export const isCompactionItem = (item: Json) => ['compaction', 'compaction_summary', 'context_compaction'].includes(item?.type)
export const isCompactionRequest = (body: Json) => Array.isArray(body?.input) && body.input.some((item: Json) => item?.type === 'compaction_trigger')

function decode(encrypted: string) {
  for (const known of [prefix, ccSwitchPrefix]) {
    if (encrypted.startsWith(known)) {
      try { return Buffer.from(encrypted.slice(known.length), 'base64url').toString('utf8') }
      catch { return undefined }
    }
  }
}

/** What a compaction item replays as: the summary if Anna (or cc-switch) wrote it, a note if not. */
export function compactionReplayText(item: Json) {
  const encrypted = typeof item?.encrypted_content === 'string' && item.encrypted_content ? item.encrypted_content : undefined
  if (!encrypted)
    return undefined
  const summary = decode(encrypted)
  return summary !== undefined ? `${summaryPrefix}\n${summary}` : opaqueCompactionNote
}

export const userMessageItem = (text: string) => ({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] })

export const compactionOutputItem = (summary: string) => ({ type: 'compaction', id: `cmp_${randomUUID().replace(/-/g, '')}`, encrypted_content: `${prefix}${Buffer.from(summary, 'utf8').toString('base64url')}` })

/** The summary text of a compaction turn's output items. */
export function summaryFromOutput(items: Json[]) {
  const parts: string[] = []
  for (const item of items) {
    if (item?.type !== 'message' || !Array.isArray(item.content))
      continue
    for (const part of item.content) {
      const text = part?.type === 'output_text' && typeof part.text === 'string' ? part.text.trim() : ''
      if (text)
        parts.push(text)
    }
  }
  return parts.join('\n\n')
}

/** Why a compaction turn can't be trusted to be whole, or undefined when it ended normally. */
export function compactionIncompleteReason(finishReason?: string) {
  const reason = finishReason?.trim()
  if (!reason)
    return undefined
  const lower = reason.toLowerCase()
  if (['stop', 'end_turn', 'stop_sequence'].includes(lower))
    return undefined
  if (['length', 'max_tokens', 'model_context_window_exceeded'].includes(lower))
    return 'max_output_tokens'
  if (['content_filter', 'sensitive', 'refusal'].includes(lower))
    return 'content_filter'
  return reason
}
