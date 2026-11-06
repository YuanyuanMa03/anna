import type { HumanPreference, MeasuredRun } from './compare'
import { randomInt } from 'node:crypto'
import { compareRuns } from './compare'

export interface ReviewRun extends MeasuredRun { answer: string, deliverables: Record<string, string>, workspace?: string }
export interface BlindVote { id: string, winner: 'A' | 'B' | 'tie' }
export interface ReviewKey { id: string, caseId: string, repetition: number, a: 'baseline' | 'candidate' }

/** Keep the returned key separate from the reviewer packet until all votes are submitted. */
export function blindReview(runs: ReviewRun[], coin: () => number = () => randomInt(2)) {
  if (!compareRuns(runs).complete)
    throw new Error('盲评需要两组各 36 次完整运行')
  const key: ReviewKey[] = []
  const packets = runs.filter(run => run.variant === 'baseline').map((baseline, index) => {
    const candidate = runs.find(run => run.variant === 'candidate' && run.caseId === baseline.caseId && run.repetition === baseline.repetition)!
    const a = coin() === 0 ? baseline : candidate
    const b = a === baseline ? candidate : baseline
    const id = `pair-${String(index + 1).padStart(2, '0')}`
    key.push({ id, caseId: baseline.caseId, repetition: baseline.repetition, a: a.variant })
    // Do not expose success checks, latency, token counts or variant names before the quality vote.
    const output = (run: ReviewRun) => {
      const redact = (text: string) => run.workspace ? text.replaceAll(run.workspace, '<工作目录>').replaceAll(run.workspace.replaceAll('\\', '/'), '<工作目录>') : text
      return { answer: redact(run.answer), deliverables: Object.fromEntries(Object.entries(run.deliverables).map(([path, text]) => [path, redact(text)])) }
    }
    return { id, caseId: baseline.caseId, A: output(a), B: output(b) }
  })
  return { packets, key }
}

export function resolveVotes(votes: BlindVote[], key: ReviewKey[]): HumanPreference[] {
  const seen = new Set<string>()
  return votes.map((vote) => {
    const pair = key.find(item => item.id === vote.id)
    if (!pair || seen.has(vote.id) || !['A', 'B', 'tie'].includes(vote.winner))
      throw new Error('盲评记录包含未知编号、重复编号或无效选择')
    seen.add(vote.id)
    const winner = vote.winner === 'tie' ? 'tie' : vote.winner === 'A' ? pair.a : pair.a === 'baseline' ? 'candidate' : 'baseline'
    return { caseId: pair.caseId, repetition: pair.repetition, winner }
  })
}
