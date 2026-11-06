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

/**
 * A running tally kept in settings, because the journal and the diary only keep their most recent entries: when they
 * started, how many tasks they have finished, the first one, and each tenth as it happened.
 */
export interface Together {
  since?: string
  done: number
  firstTask?: { at: string, text: string }
  milestones: { at: string, text: string }[]
}

type Record = Pick<TaskRecord, 'at' | 'status' | 'request' | 'undone'>
type Memory = Pick<MemoryItem, 'text' | 'createdAt' | 'kind'>

function short(text: string, length = 36) {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > length ? `${line.slice(0, length - 1)}…` : line
}
function dayOf(iso: string | Date) {
  const d = new Date(iso)
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}
const time = (iso: string) => Date.parse(iso) || 0
const earliest = (values: (string | undefined)[]) => values.filter((value): value is string => Boolean(value)).sort((a, b) => time(a) - time(b))[0]
const kept = (records: Record[]) => records.filter(record => record.status === 'completed' && !record.undone).sort((a, b) => time(a.at) - time(b.at))

/** The tally for someone who used Anna before it was kept: what the journal and diary still hold. */
export function seedTogether(records: Record[], memories: Memory[]): Together {
  const finished = kept(records)
  const since = earliest([...records.map(record => record.at), ...memories.map(memory => memory.createdAt)])
  return { ...(since ? { since } : {}), done: finished.length, ...(finished[0] ? { firstTask: { at: finished[0].at, text: short(finished[0].request, 30) } } : {}), milestones: [] }
}

/** A task was finished: count it, and mark the first and every tenth. */
export function advanceTogether(tally: Together, task: { at: string, request: string }): Together {
  const done = tally.done + 1
  return {
    since: earliest([tally.since, task.at]),
    done,
    firstTask: tally.firstTask ?? { at: task.at, text: short(task.request, 30) },
    milestones: done % 10 === 0 ? [...tally.milestones, { at: task.at, text: `一起完成了第 ${done} 件事` }].slice(-50) : tally.milestones,
  }
}

/** A finished task was undone: it no longer counts, but what was marked when it happened stays. */
export function undoTogether(tally: Together): Together {
  return { ...tally, done: Math.max(0, tally.done - 1) }
}

export function relationshipOf(records: Record[], memories: Memory[], now = new Date(), tally?: Together): Relationship {
  const finished = kept(records)
  const known = tally ?? seedTogether(records, memories)
  const since = earliest([known.since, ...records.map(record => record.at), ...memories.map(memory => memory.createdAt)])
  const first = known.firstTask
  const moments: Relationship['moments'] = [
    // The first task is told once, as the milestone.
    ...finished.filter(record => !(first && record.at === first.at)).map(record => ({ at: record.at, kind: 'task' as const, text: short(record.request) })),
    ...memories.map(memory => ({ at: memory.createdAt, kind: 'memory' as const, text: `记住了：${short(memory.text, 32)}` })),
    ...(first ? [{ at: first.at, kind: 'milestone' as const, text: `第一次一起完成：${first.text}` }] : []),
    ...known.milestones.map(milestone => ({ at: milestone.at, kind: 'milestone' as const, text: milestone.text })),
  ]
  // Newest first; at the same moment a milestone reads before anything else.
  const rank = { milestone: 0, memory: 1, task: 2 }
  moments.sort((a, b) => time(b.at) - time(a.at) || rank[a.kind] - rank[b.kind])
  const recent = moments.slice(0, 22)
  const story = moments.length > 24 ? [...recent, ...moments.filter(m => m.kind === 'milestone' && !recent.includes(m)).slice(-2)] : moments
  return {
    ...(since ? { since } : {}),
    days: since ? Math.max(1, Math.round((dayOf(now) - dayOf(since)) / 86_400_000) + 1) : 0,
    done: tally ? tally.done : finished.length,
    remembered: memories.length,
    agreements: memories.filter(memory => memory.kind === 'agreement').length,
    moments: story,
  }
}
