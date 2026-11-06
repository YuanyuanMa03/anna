import type { MemoryItem, TaskRecord } from './contracts'

/** What Anna and the user have been through, from the work records and her diary only: nothing estimated or scored. */
export interface Relationship {
  /** The earliest record of either kind. */
  since?: string
  /** Calendar days from `since` to today, counting both. */
  days: number
  /** Tasks finished and not undone. */
  done: number
  remembered: number
  agreements: number
  /** Newest first. */
  moments: { at: string, kind: 'task' | 'memory' | 'milestone', text: string }[]
}

function short(text: string, length = 36) {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > length ? `${line.slice(0, length - 1)}…` : line
}
function dayOf(iso: string | Date) { const d = new Date(iso); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) }

export function relationshipOf(records: Pick<TaskRecord, 'at' | 'status' | 'request' | 'undone'>[], memories: Pick<MemoryItem, 'text' | 'createdAt' | 'kind'>[], now = new Date()): Relationship {
  const kept = records.filter(record => record.status === 'completed' && !record.undone).sort((a, b) => a.at.localeCompare(b.at))
  const since = [...records.map(record => record.at), ...memories.map(memory => memory.createdAt)].sort()[0]
  const moments: Relationship['moments'] = [
    ...kept.map(record => ({ at: record.at, kind: 'task' as const, text: short(record.request) })),
    ...memories.map(memory => ({ at: memory.createdAt, kind: 'memory' as const, text: `记住了：${short(memory.text, 32)}` })),
    ...kept.flatMap((record, index) => index === 0
      ? [{ at: record.at, kind: 'milestone' as const, text: `第一次一起完成：${short(record.request, 30)}` }]
      : (index + 1) % 10 === 0 ? [{ at: record.at, kind: 'milestone' as const, text: `一起完成了第 ${index + 1} 件事` }] : []),
  ]
  // Newest first; at the same moment a milestone reads before the task it marks.
  const rank = { milestone: 0, memory: 1, task: 2 }
  moments.sort((a, b) => b.at.localeCompare(a.at) || rank[a.kind] - rank[b.kind])
  const story = moments.length > 24 ? [...moments.slice(0, 22), ...moments.filter(m => m.kind === 'milestone' && !moments.slice(0, 22).includes(m)).slice(-2)] : moments
  return {
    ...(since ? { since } : {}),
    days: since ? Math.round((dayOf(now) - dayOf(since)) / 86_400_000) + 1 : 0,
    done: kept.length,
    remembered: memories.length,
    agreements: memories.filter(memory => memory.kind === 'agreement').length,
    moments: story.slice(0, 24),
  }
}
