import type { FailoverEvent, RouteHandle } from '../routing/server'
import type { DelegateAgent } from './adapters'
import type { ProviderChoice } from './providers'
import { routing } from '../routing/server'
import { canRoute, chatRouteOf, routedThroughAnna, upstreamOf } from './providers'

export interface RouteOptions {
  /** Providers to try, in order, when the chosen one fails. */
  backups?: ProviderChoice[]
  onFailover?: (event: FailoverEvent) => void
}

/**
 * A route through Anna's local routing for one run, when the agent can't reach the provider directly (a Chat
 * Completions provider for Claude Code or Codex) or has backups to fall back on. Without either, undefined: the agent
 * talks to its provider directly, as before. Close the route when the run ends: its token stops working.
 */
export async function openRoute(agent: DelegateAgent, provider?: ProviderChoice, options: RouteOptions = {}): Promise<RouteHandle | undefined> {
  if ((agent !== 'codex' && agent !== 'claude') || !provider || !canRoute(agent, provider.preset))
    return undefined
  const backups = (options.backups ?? []).filter(backup => backup.preset.name !== provider.preset.name && canRoute(agent, backup.preset))
  if (!routedThroughAnna(agent, provider.preset) && !backups.length)
    return undefined
  return (await routing()).open({ ...chatRouteOf(agent, provider), ...(backups.length ? { backups: backups.map(backup => upstreamOf(agent, backup)) } : {}), ...(options.onFailover ? { onFailover: options.onFailover } : {}) })
}

const why = (event: FailoverEvent) => event.kind === 'status' ? `返回了 ${event.status}` : event.kind === 'timeout' ? '迟迟没有回应' : event.kind === 'empty' ? '返回了空内容' : '连不上'

/** The line the stage shows for a failover. */
export const failoverLine = (event: FailoverEvent) => event.to ? `${event.from} ${why(event)}，换成 ${event.to}` : `${event.from} ${why(event)}，备用服务商也都不行`
