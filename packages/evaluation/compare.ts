/** Offline analysis only: this module never calls a model or estimates missing token counts. */
export interface MeasuredRun {
  caseId: string
  repetition: number
  variant: 'baseline' | 'candidate'
  model: string
  configuration: string
  success: boolean
  usage?: { input?: number, output?: number, cacheRead?: number, cacheWrite?: number, partial?: boolean }
  elapsedMs: number
  retries: number
}
export interface HumanPreference { caseId: string, repetition: number, winner: 'baseline' | 'candidate' | 'tie' }
const ids = ['F01', 'F02', 'F03', 'T01', 'T02', 'T03', 'P01', 'P02', 'P03', 'C01', 'C02', 'C03']
function median(values: number[]) {
  if (!values.length)
    return undefined
  const ordered = [...values].sort((a, b) => a - b)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2
}
function tokens(run: MeasuredRun) {
  const usage = run.usage
  if (!usage || usage.partial || usage.input === undefined || usage.output === undefined || usage.cacheRead === undefined || usage.cacheWrite === undefined)
    return undefined
  const values = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite]
  return values.every(value => Number.isFinite(value) && value >= 0) ? values.reduce((sum, value) => sum + value, 0) : undefined
}

export function compareRuns(runs: MeasuredRun[], preferences: HumanPreference[] = []) {
  const keys = new Set<string>()
  const configurations = new Set<string>()
  for (const run of runs) {
    if (!ids.includes(run.caseId) || ![1, 2, 3].includes(run.repetition) || !['baseline', 'candidate'].includes(run.variant))
      throw new Error('对照包含未知任务、重复次数或组别')
    if (!run.model?.trim() || !run.configuration?.trim() || typeof run.success !== 'boolean' || !Number.isFinite(run.elapsedMs) || run.elapsedMs < 0 || !Number.isInteger(run.retries) || run.retries < 0)
      throw new Error('每次运行必须包含实际模型、固定设置、完成状态、有效耗时和重试次数')
    const key = `${run.caseId}:${run.repetition}:${run.variant}`
    if (keys.has(key))
      throw new Error('同一任务与重复次数存在重复结果')
    keys.add(key)
    configurations.add(JSON.stringify([run.model, run.configuration]))
  }
  if (configurations.size > 1)
    throw new Error('两组必须使用相同模型与设置')
  const reviewKeys = new Set<string>()
  for (const review of preferences) {
    const key = `${review.caseId}:${review.repetition}`
    if (!ids.includes(review.caseId) || ![1, 2, 3].includes(review.repetition) || !['baseline', 'candidate', 'tie'].includes(review.winner) || reviewKeys.has(key))
      throw new Error('人工偏好记录无效或重复')
    reviewKeys.add(key)
  }
  const summarize = (variant: MeasuredRun['variant']) => {
    const group = runs.filter(run => run.variant === variant)
    const measured = group.map(tokens).filter((value): value is number => value !== undefined)
    return { runs: group.length, successRate: group.length ? group.filter(run => run.success).length / group.length : undefined, measuredUsage: measured.length, medianTokens: median(measured), medianElapsedMs: median(group.map(run => run.elapsedMs)), medianRetries: median(group.map(run => run.retries)) }
  }
  const baseline = summarize('baseline')
  const candidate = summarize('candidate')
  const complete = runs.length === 72
  const usageComplete = complete && baseline.measuredUsage === 36 && candidate.measuredUsage === 36
  const reduction = usageComplete && baseline.medianTokens && candidate.medianTokens !== undefined ? 1 - candidate.medianTokens / baseline.medianTokens : undefined
  const votes = { baseline: 0, candidate: 0, tie: 0 }
  for (const review of preferences) votes[review.winner]++
  const reviewed = preferences.length === 36
  const qualityMaintained = complete && reviewed && candidate.successRate! >= baseline.successRate! && votes.candidate >= votes.baseline
  return { complete, usageComplete, baseline, candidate, reduction, humanReview: { completed: preferences.length, pending: 36 - preferences.length, votes }, qualityMaintained, targetMet: qualityMaintained && reduction !== undefined && reduction >= 0.15 }
}
