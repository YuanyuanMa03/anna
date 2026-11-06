import { describe, expect, it } from 'vitest'
import { advanceTogether, relationshipOf, seedTogether, undoTogether } from '../packages/shared/relationship'

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

it('tells their story newest first, with the first task as a milestone, from records only', () => {
  const tasks = Array.from({ length: 10 }, (_, i) => task(`2026-11-0${Math.min(i, 8) + 1}T0${i % 10}:00:00`, `任务 ${i + 1}`))
  const r = relationshipOf(tasks, [memory('2026-11-02T12:00:00', '喜欢猫')], new Date('2026-11-10T00:00:00'))
  // Without a running tally yet (an upgrade), the story is seeded from the records that exist.
  expect(r.moments[0]).toMatchObject({ kind: 'milestone', text: '一起完成了第 10 件事' })
  expect(r.moments.at(-1)?.text).toBe('第一次一起完成：任务 1')
  expect(r.moments.some(m => m.text === '任务 1')).toBe(false)
  expect(r.moments.some(m => m.kind === 'memory' && m.text === '记住了：喜欢猫')).toBe(true)
  expect(r.moments.map(m => m.at)).toEqual([...r.moments.map(m => m.at)].sort().reverse())
})

it('keeps the story short and requests readable', () => {
  const tasks = Array.from({ length: 80 }, (_, i) => task(new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString(), `很长的请求 ${'字'.repeat(60)}`))
  const r = relationshipOf(tasks, [], new Date('2026-11-10T00:00:00'))
  expect(r.moments.length).toBeLessThanOrEqual(24)
  expect(r.moments.every(m => m.text.length <= 44)).toBe(true)
})

describe('the running tally', () => {
  it('starts from what is on record, then counts every finished task even after the journal forgets it', () => {
    let tally = seedTogether([task('2026-10-01T09:00:00.000Z', '第一件事')], [memory('2026-09-30T08:00:00.000Z', '喜欢猫')])
    expect(tally).toMatchObject({ since: '2026-09-30T08:00:00.000Z', done: 1, firstTask: { at: '2026-10-01T09:00:00.000Z', text: '第一件事' } })
    for (let i = 2; i <= 45; i++)
      tally = advanceTogether(tally, { at: new Date(Date.UTC(2026, 9, 1, 9) + i * 3_600_000).toISOString(), request: `第 ${i} 件` })
    expect(tally.done).toBe(45)
    expect(tally.milestones.map(m => m.text)).toEqual(['一起完成了第 10 件事', '一起完成了第 20 件事', '一起完成了第 30 件事', '一起完成了第 40 件事'])
    // The journal keeps only its last 40; the story still starts where they really started.
    const recent = Array.from({ length: 40 }, (_, i) => task(new Date(Date.UTC(2026, 9, 1, 9) + (i + 6) * 3_600_000).toISOString(), `第 ${i + 6} 件`))
    const r = relationshipOf(recent, [], new Date('2026-10-05T12:00:00.000Z'), tally)
    expect(r).toMatchObject({ since: '2026-09-30T08:00:00.000Z', done: 45 })
    expect(r.days).toBe(6)
    expect(r.moments.some(m => m.text === '第一次一起完成：第一件事')).toBe(true)
    expect(r.moments.filter(m => m.text.startsWith('一起完成了第')).length).toBeGreaterThan(0)
  })

  it('takes back an undone task without rewriting what already happened', () => {
    const tally = undoTogether(seedTogether([task('2026-10-01T09:00:00.000Z', 'a'), task('2026-10-02T09:00:00.000Z', 'b')], []))
    expect(tally.done).toBe(1)
    expect(undoTogether({ ...tally, done: 0 }).done).toBe(0)
  })

  it('does not list the first task twice, and never shows day 0', () => {
    const r = relationshipOf([task('2026-11-06T09:00:00.000Z', '聊聊茶')], [], new Date('2026-11-01T00:00:00.000Z'))
    expect(r.moments.map(m => m.text)).toEqual(['第一次一起完成：聊聊茶'])
    expect(r.days).toBe(1)
  })

  it('marks each tenth once, even when an undo and a new task reach it again, and seeds past tenths', () => {
    let tally = seedTogether(Array.from({ length: 9 }, (_, i) => task(`2026-10-0${i + 1}T09:00:00.000Z`, `t${i}`)), [])
    tally = advanceTogether(tally, { at: '2026-10-10T09:00:00.000Z', request: 'ten' })
    tally = advanceTogether(undoTogether(tally), { at: '2026-10-11T09:00:00.000Z', request: 'ten again' })
    expect(tally.milestones.map(m => m.text)).toEqual(['一起完成了第 10 件事'])
    expect(seedTogether(Array.from({ length: 25 }, (_, i) => task(new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString(), `t${i}`)), []).milestones.map(m => m.text)).toEqual(['一起完成了第 10 件事', '一起完成了第 20 件事'])
  })
})
