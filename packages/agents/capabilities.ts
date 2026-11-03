import type { CapabilityReport } from '../shared/contracts'
import type { AgentLocation } from './codex-rpc'
import { withCodex } from './codex-rpc'

/** Query stable, read-only metadata methods. Plugin discovery is not a stable Codex API. */
export async function codexCapabilities(location: AgentLocation, cwd: string): Promise<CapabilityReport> {
  return withCodex(location, cwd, async (request) => {
    const report: CapabilityReport = { at: new Date().toISOString(), source: 'Codex app-server', entries: [], unknown: ['plugins'] }
    const skills = await request('skills/list', { cwds: [cwd] }).catch(() => undefined)
    if (!skills)
      report.unknown.push('skills')
    for (const group of skills?.data ?? []) {
      for (const skill of group.skills ?? []) report.entries.push({ kind: 'skill', name: skill.name, source: skill.path ?? 'Codex', state: skill.enabled === false ? 'configured' : 'available' })
      for (const error of group.errors ?? []) report.entries.push({ kind: 'skill', name: error.path ?? '加载失败', source: 'Codex', state: 'error' })
    }
    let cursor: string | undefined
    let pages = 0
    do {
      const mcp = await request('mcpServerStatus/list', { cursor, limit: 50 }).catch(() => undefined)
      if (!mcp) { report.unknown.push('mcp'); break }
      for (const server of mcp.data ?? []) {
        report.entries.push({ kind: 'mcp', name: server.name, source: 'Codex', state: server.authStatus === 'notLoggedIn' ? 'configured' : 'available' })
        for (const tool of Object.values(server.tools ?? {}) as { name: string }[]) report.entries.push({ kind: 'tool', name: tool.name, source: server.name, state: 'available' })
      }
      cursor = mcp.nextCursor || undefined
      pages++
    } while (cursor && pages < 20)
    if (cursor)
      report.unknown.push('mcp')
    return report
  })
}
