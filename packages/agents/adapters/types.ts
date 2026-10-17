import type { KernelEvent } from '../../kernels/types'

/** A permission request from an external agent, with the tool normalized to Anna's names. */
export interface AgentApproval { id: string | number, tool: string, input: Record<string, unknown>, /** Protocol-specific payload needed to answer. */ raw: unknown }

export interface Decoded {
  events: KernelEvent[]
  approval?: AgentApproval
  sessionId?: string
  /** The turn finished. */
  done?: { text: string, isError: boolean }
}

/**
 * Turns one line of an agent's headless output into Anna events. Pure and stateful per run, so it can be tested by
 * replaying recorded sessions (tests/fixtures/agents).
 */
export interface Decoder {
  decode: (line: string) => Decoded
  /** The line to write back to the agent's stdin for a permission decision. */
  answer: (approval: AgentApproval, decision: { allow: boolean, reason?: string }) => string
}

export const nothing = (): Decoded => ({ events: [] })
