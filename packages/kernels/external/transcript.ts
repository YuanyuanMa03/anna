import type { Message, Origin } from '../../shared/contracts'

/** Anna's own transcript for a brain whose session files are not hers to read: messages plus her own records. */
export type TranscriptEntry = { kind: 'user' | 'assistant', text: string, origin: Origin, aborted?: boolean } | { kind: string, data: unknown }

/** The conversation as the person sees it: messages, interrupted turns and delegations. */
export function historyOf(entries: TranscriptEntry[]): Message[] {
  const out: Message[] = []
  for (const entry of entries) {
    if (entry.kind === 'user' || entry.kind === 'assistant') {
      const message = entry as { kind: 'user' | 'assistant', text: string, origin: Origin }
      if (message.text)
        out.push({ role: message.kind, text: message.text, origin: message.origin })
    }
    else if (entry.kind === 'aborted') {
      out.push({ role: 'assistant', text: '这一轮被中断了。随时可以继续。', note: true })
    }
    else if (entry.kind === 'delegation') {
      const record = (entry as { data: { task: string, text: string, origin?: Origin, delegation: Message['delegation'], nested?: boolean } }).data
      if (!record.nested)
        out.push({ role: 'user', text: record.task, origin: record.origin ?? 'desktop' })
      out.push({ role: 'assistant', text: record.text, origin: record.origin ?? 'desktop', delegation: record.delegation })
    }
  }
  return out
}
