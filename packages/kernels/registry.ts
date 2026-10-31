import type { AgentId } from '../agents/catalog'
import type { BrainId } from '../shared/contracts'
import type { KernelFactory } from './types'
import { catalog } from '../agents/catalog'
import { AcpKernel } from './acp/kernel'
import { ExternalKernel } from './external/kernel'
import { createPiKernel } from './pi/kernel'

/**
 * Available agent kernels: pi, Claude Code and Codex through their own protocols, and any catalogued agent that speaks
 * the Agent Client Protocol (`acp:<agent id>`). A new agent with its own protocol means an adapter that implements
 * AgentKernel, maps tool names to Anna's normalized ones, and calls `gate` before each tool. See docs/kernels.md.
 */
export const kernels = {
  'pi': { label: 'pi coding agent', create: (context => createPiKernel(context)) as KernelFactory, available: true },
  'claude-code': { label: 'Claude Code', create: (context => new ExternalKernel(context, 'claude')) as KernelFactory, available: true },
  'codex': { label: 'Codex', create: (context => new ExternalKernel(context, 'codex')) as KernelFactory, available: true },
} as const

export type KernelId = keyof typeof kernels

/** The kernel behind a brain id; an ACP brain is available when its agent is catalogued with ACP arguments. */
export function kernelFor(id: BrainId): { label: string, create: KernelFactory, available: boolean } {
  if (!id.startsWith('acp:'))
    return kernels[id as KernelId] ?? { label: id, create: kernels.pi.create, available: false }
  const agent = id.slice(4) as AgentId
  const entry = catalog.find(item => item.id === agent)
  return { label: entry?.label ?? agent, create: context => new AcpKernel(context, agent), available: Boolean(entry?.acp) }
}
