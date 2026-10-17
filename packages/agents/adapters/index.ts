import type { Decoder } from './types'
import { claudeDecoder } from './claude'
import { codexDecoder } from './codex'
import { geminiDecoder, opencodeDecoder, piDecoder } from './simple'

export type DelegateAgent = 'claude' | 'codex' | 'gemini' | 'opencode' | 'pi'

/**
 * How each delegate agent asks for permission:
 * - forwarded: every risky tool call comes to Anna's approval card mid-run (Claude Code, Codex)
 * - upfront: the agent cannot ask mid-run; Anna asks once before delegating and sets the agent's own approval level
 */
export const approvalStyle: Record<DelegateAgent, 'forwarded' | 'upfront'> = { claude: 'forwarded', codex: 'forwarded', gemini: 'upfront', opencode: 'upfront', pi: 'upfront' }
/** Decoders verified against recorded real sessions; the rest follow published schemas. */
export const verified: Record<DelegateAgent, boolean> = { claude: true, codex: true, gemini: false, opencode: false, pi: false }

export function decoderFor(agent: DelegateAgent): Decoder {
  switch (agent) {
    case 'claude': return claudeDecoder()
    case 'codex': return codexDecoder()
    case 'gemini': return geminiDecoder()
    case 'opencode': return opencodeDecoder()
    case 'pi': return piDecoder()
  }
}
