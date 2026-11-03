import { expect, it } from 'vitest'
import { parseCodexQuota } from '../packages/agents/native-usage'

it('preserves actual quota durations and does not merge independent buckets', () => {
  const result = parseCodexQuota({ rateLimitsByLimitId: { codex: { primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: 1700000000 }, secondary: { usedPercent: 40, windowDurationMins: 10080 } }, other: { primary: { usedPercent: 50, windowDurationMins: 300 } } } })
  expect(result.windows).toHaveLength(3)
  expect(result.windows?.[0]).toMatchObject({ window: 'custom', durationMinutes: 15, label: 'codex · 15 分钟', usedPercent: 25 })
  expect(result.windows?.[1]?.window).toBe('weekly')
  expect(result.windows?.[2]).toMatchObject({ label: 'other · 5 小时', window: 'five_hour' })
})

it('marks an absent or malformed quota as unknown', () => {
  expect(parseCodexQuota({}).error).toBeTruthy()
  expect(parseCodexQuota({ rateLimits: { primary: { usedPercent: '25%' } } }).error).toBeTruthy()
})
