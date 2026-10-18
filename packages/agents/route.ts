import type { RouteHandle } from '../routing/server'
import type { DelegateAgent } from './adapters'
import type { ProviderChoice } from './providers'
import { routing } from '../routing/server'
import { chatRouteOf, routedThroughAnna } from './providers'

/**
 * A route through Anna's local routing for one run, when the agent can't reach the provider directly (Codex and a
 * Chat Completions provider). Close it when the run ends: its token stops working.
 */
export async function openRoute(agent: DelegateAgent, provider?: ProviderChoice): Promise<RouteHandle | undefined> {
  if (agent !== 'codex' || !provider || !routedThroughAnna('codex', provider.preset))
    return undefined
  return (await routing()).open(chatRouteOf(provider))
}
