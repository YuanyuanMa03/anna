import { expect, it } from 'vitest'
import { relationshipOf } from '../packages/shared/relationship'

const task = (at: string, request: string, status: 'completed' | 'aborted' | 'failed' = 'completed', undone = false) => ({ at, request, status, undone })
const memory = (createdAt: string, text: string, kind?: 'preference' | 'agreement' | 'experience') => ({ id: text, text, createdAt, kind })

it('is empty before anything happened', () => {
  expect(relationshipOf([], [], new Date('2026-11-06T12:00:00'))).toEqual({ days: 0, done: 0, remembered: 0, agreements: 0, moments: [] })
})

it('counts days from the earliest real record, and only work that was finished and kept', () => {
  const r = relationshipOf(
    [task('2026-11-04T09:00:00', '整理 tasks.txt'), task('2026-11-05T10:00:00', '慢慢想', 'aborted'), task('2026-11-05T11:00:00', '改个错字', 'completed', true), task('2026-11-06T08:00:00', '写周报')],
    [memory('2026-11-03T20:00:00', '喜欢简短回答', 'preference'), memory('2026-11-05T20:00:00', '周五不加班', 'agreement')],
    new Date('2026-11-06T12:00:00'),
  )
  expect(r).toMatchObject({ since: '2026-11-03T20:00:00', days: 4, done: 2, remembered: 2, agreements: 1 })
})

it('tells their story newest first, with milestones, from records only', () => {
  const tasks = Array.from({ length: 10 }, (_, i) => task(`2026-11-0${Math.min(i, 8) + 1}T0${i % 10}:00:00`, `任务 ${i + 1}`))
  const r = relationshipOf(tasks, [memory('2026-11-02T12:00:00', '喜欢猫')], new Date('2026-11-10T00:00:00'))
  expect(r.moments[0]).toMatchObject({ kind: 'milestone', text: '一起完成了第 10 件事' })
  expect(r.moments.slice(-2).map(m => m.text)).toEqual(['第一次一起完成：任务 1', '任务 1'])
  expect(r.moments.some(m => m.kind === 'memory' && m.text === '记住了：喜欢猫')).toBe(true)
  expect(r.moments.map(m => m.at)).toEqual([...r.moments.map(m => m.at)].sort().reverse())
})

it('keeps the story short and requests readable', () => {
  const tasks = Array.from({ length: 80 }, (_, i) => task(new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString(), `很长的请求 ${'字'.repeat(60)}`))
  const r = relationshipOf(tasks, [], new Date('2026-11-10T00:00:00'))
  expect(r.moments.length).toBeLessThanOrEqual(24)
  expect(r.moments.every(m => m.text.length <= 44)).toBe(true)
})
