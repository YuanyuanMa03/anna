import type { KernelFactory } from './types'
import { ExternalKernel } from './external/kernel'
import { createPiKernel } from './pi/kernel'

/**
 * Available agent kernels. Adding Claude Code (Claude Agent SDK) or Codex (codex app-server) means writing an adapter
 * that implements AgentKernel, maps tool names to Anna's normalized ones, and calls `gate` before each tool
 * (Agent SDK: `canUseTool`; Codex: approval requests). See docs/kernels.md.
 */
export const kernels = {
  'pi': { label: 'pi coding agent', create: (context => createPiKernel(context)) as KernelFactory, available: true },
  'claude-code': { label: 'Claude Code', create: (context => new ExternalKernel(context, 'claude')) as KernelFactory, available: true },
  'codex': { label: 'Codex', create: (context => new ExternalKernel(context, 'codex')) as KernelFactory, available: true },
} as const

export type KernelId = keyof typeof kernels
