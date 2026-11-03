import type { ReviewRun } from '../packages/evaluation/blind-review'
import { expect, it } from 'vitest'
import { blindReview, resolveVotes } from '../packages/evaluation/blind-review'

function runs(): ReviewRun[] {
  return ['F', 'T', 'P', 'C'].flatMap(prefix => [1, 2, 3].flatMap(index => [1, 2, 3].flatMap(repetition => (['baseline', 'candidate'] as const).map(variant => ({ caseId: `${prefix}0${index}`, repetition, variant, model: 'fixture', configuration: 'fixed', success: true, elapsedMs: 1, retries: 0, answer: '结果', deliverables: { 'result.md': '成果' } })))))
}
it('conceals runtime and variant metadata while preserving results and a separate answer key', () => {
  const { packets, key } = blindReview(runs(), () => 1)
  expect(packets).toHaveLength(36)
  expect(JSON.stringify(packets)).not.toMatch(/baseline|candidate|elapsedMs|repetition|model|configuration|success/)
  expect(packets[0]!.A.deliverables).toEqual({ 'result.md': '成果' })
  expect(resolveVotes([{ id: 'pair-01', winner: 'A' }, { id: 'pair-02', winner: 'B' }], key)).toEqual([
    { caseId: 'F01', repetition: 1, winner: 'candidate' },
    { caseId: 'F01', repetition: 2, winner: 'baseline' },
  ])
})
it('rejects incomplete runs and duplicated or unknown reviews', () => {
  expect(() => blindReview(runs().slice(1))).toThrow('完整运行')
  const { key } = blindReview(runs())
  expect(() => resolveVotes([{ id: 'unknown', winner: 'tie' }], key)).toThrow('未知编号')
  expect(() => resolveVotes([{ id: 'pair-01', winner: 'tie' }, { id: 'pair-01', winner: 'A' }], key)).toThrow('重复编号')
})

it('removes variant-revealing workspace paths from answers and deliverables', () => {
  const results = runs().map(run => ({ ...run, workspace: `/tmp/${run.variant}/workspace`, answer: `查看 /tmp/${run.variant}/workspace/result.md`, deliverables: { 'result.md': `来源 /tmp/${run.variant}/workspace/source.txt` } }))
  const { packets } = blindReview(results)
  expect(JSON.stringify(packets)).not.toMatch(/baseline|candidate/)
  expect(packets[0]!.A.answer).toBe('查看 <工作目录>/result.md')
})
