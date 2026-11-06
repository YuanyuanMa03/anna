import type { MeasuredRun } from '../packages/evaluation/compare'
import { expect, it } from 'vitest'
import { compareRuns } from '../packages/evaluation/compare'

function fixture(): MeasuredRun[] {
  return ['F', 'T', 'P', 'C'].flatMap(prefix => [1, 2, 3].flatMap(index => [1, 2, 3].flatMap(repetition => (['baseline', 'candidate'] as const).map(variant => ({ caseId: `${prefix}0${index}`, repetition, variant, model: 'fixture-model', configuration: 'fixed-settings', success: true, elapsedMs: 100, retries: 0, usage: { input: variant === 'baseline' ? 100 : 80, output: 0, cacheRead: 0, cacheWrite: 0 } })))))
}

it('does not claim quality or efficiency achievement before human review', () => {
  const result = compareRuns(fixture())
  expect(result.complete).toBe(true)
  expect(result.reduction).toBeCloseTo(0.2)
  expect(result.qualityMaintained).toBe(false)
  expect(result.targetMet).toBe(false)
})

it('does not fabricate missing usage or accept duplicate or mismatched comparisons', () => {
  const runs = fixture()
  runs[0]!.usage = undefined
  expect(compareRuns(runs).reduction).toBeUndefined()
  expect(() => compareRuns([...runs, runs[1]!])).toThrow('重复结果')
  runs[0]!.model = 'other-model'
  expect(() => compareRuns(runs)).toThrow('相同模型')
})

it('requires complete paired evidence and favorable human quality before marking the target met', () => {
  const runs = fixture()
  const reviews = runs.filter(run => run.variant === 'baseline').map(run => ({ caseId: run.caseId, repetition: run.repetition, winner: 'candidate' as const }))
  expect(compareRuns(runs, reviews).targetMet).toBe(true)
  expect(compareRuns(runs.slice(1), reviews).targetMet).toBe(false)
  expect(compareRuns(runs, reviews.map(review => ({ ...review, winner: 'baseline' as const }))).targetMet).toBe(false)
})

it('does not treat unknown cache usage as zero or accept invalid measurements', () => {
  const runs = fixture()
  runs[0]!.usage!.cacheRead = undefined
  expect(compareRuns(runs).usageComplete).toBe(false)
  expect(compareRuns(runs).reduction).toBeUndefined()
  runs[0]!.elapsedMs = Number.NaN
  expect(() => compareRuns(runs)).toThrow('有效耗时')
})
