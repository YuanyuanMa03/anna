import type { UsageReport } from '../shared/contracts'
import type { AgentLocation } from './codex-rpc'
import { withCodex } from './codex-rpc'

/** Keep quota buckets separate and preserve their real duration; they need not be five-hour windows. */
export function parseCodexQuota(value: any): Omit<UsageReport, 'at'> {
  const buckets = value.rateLimitsByLimitId && Object.keys(value.rateLimitsByLimitId).length ? Object.entries(value.rateLimitsByLimitId) : [['codex', value.rateLimits]]
  const windows: NonNullable<UsageReport['windows']> = []
  for (const [id, raw] of buckets) {
    const bucket = raw as any
    if (!bucket)
      continue
    for (const slot of [bucket.primary, bucket.secondary]) {
      if (!slot || typeof slot.usedPercent !== 'number' || !Number.isFinite(slot.usedPercent))
        continue
      const minutes = slot.windowDurationMins
      const duration = typeof minutes === 'number' && minutes > 0 ? minutes % 1440 === 0 ? `${minutes / 1440} 天` : minutes % 60 === 0 ? `${minutes / 60} 小时` : `${minutes} 分钟` : '额度窗口'
      const reset = typeof slot.resetsAt === 'number' ? new Date(slot.resetsAt * 1000).toISOString() : undefined
      windows.push({ window: minutes === 10080 ? 'weekly' : minutes === 300 ? 'five_hour' : 'custom', label: `${bucket.limitName || id} · ${duration}`, durationMinutes: minutes, usedPercent: slot.usedPercent, resetsAt: reset })
    }
  }
  return windows.length ? { kind: 'quota', windows } : { kind: 'quota', error: '当前账号没有返回可读取的额度窗口' }
}

export async function codexUsage(location: AgentLocation, cwd: string): Promise<Omit<UsageReport, 'at'>> {
  return withCodex(location, cwd, async request => parseCodexQuota(await request('account/rateLimits/read')))
}
