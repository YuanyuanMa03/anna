import type { Settings } from '../shared/contracts'
import { catalog } from './catalog'

export type BrainId = Settings['kernel']
/** ready: can think now · signed-out: installed but not logged in · missing: not installed · needs-key: pi has no model yet. */
export type BrainState = 'ready' | 'signed-out' | 'missing' | 'needs-key'
/** `hint` is the step that stands between a brain and thinking, empty when there is none. */
export interface BrainChoice { id: BrainId, label: string, state: BrainState, note: string, hint: string, current: boolean }

/** Agents that can be her brain, besides pi, and the catalogued agent each one runs. */
const externalBrains: { id: Exclude<BrainId, 'pi'>, agent: string, label: string }[] = [
  { id: 'claude-code', agent: 'claude', label: 'Claude Code' },
  { id: 'codex', agent: 'codex', label: 'Codex' },
]
const hints: Record<BrainState, string> = { 'ready': '', 'signed-out': '先在终端登录', 'missing': '去安装', 'needs-key': '去配置' }
/** After pi, the brains that can think now come first, then the ones a step away. */
const order: Record<BrainState, number> = { 'ready': 0, 'needs-key': 1, 'signed-out': 2, 'missing': 3 }

/** Every brain she could think with on this machine, pi first, each with what stands between it and thinking. */
export function brainChoices(input: { detected: { id: string, installed: boolean, version?: string, loggedIn?: boolean }[], current: BrainId, hasKey: boolean }): BrainChoice[] {
  const piState: BrainState = input.hasKey ? 'ready' : 'needs-key'
  const pi: BrainChoice = { id: 'pi', label: 'pi', state: piState, note: input.hasKey ? '内置 · 用你配置的模型' : '内置 · 还没配置模型', hint: hints[piState], current: input.current === 'pi' }
  const others = externalBrains.map(({ id, agent, label }): BrainChoice => {
    const info = input.detected.find(item => item.id === agent)
    const version = `v${info?.version ?? '?'}`
    // A login that cannot be checked (no status command) counts as ready; the brain reports its own errors.
    const state: BrainState = !info?.installed ? 'missing' : info.loggedIn === false ? 'signed-out' : 'ready'
    const note = state === 'missing' ? '未安装' : state === 'signed-out' ? `${version} · 未登录` : version
    return { id, label, state, note, hint: hints[state], current: input.current === id }
  })
  // Every installed agent that speaks the Agent Client Protocol can think for her too; ones not installed stay in the
  // agents sheet so the list stays short. Their login cannot be checked ahead of time; a failed turn says so.
  const acp = catalog.filter(entry => entry.acp).flatMap((entry): BrainChoice[] => {
    const info = input.detected.find(item => item.id === entry.id)
    if (!info?.installed)
      return []
    const id = `acp:${entry.id}` as const
    return [{ id, label: entry.label, state: 'ready', note: `v${info.version ?? '?'} · ACP`, hint: '', current: input.current === id }]
  })
  return [pi, ...[...others, ...acp].sort((a, b) => order[a.state] - order[b.state])]
}

/**
 * For someone whose pi has no model yet: the first agent that is installed and signed in, so one click starts her.
 * Only Claude Code and Codex qualify: an ACP agent's login cannot be checked ahead of time.
 */
export function recommendedBrain(choices: BrainChoice[]) {
  if (choices.some(choice => choice.id === 'pi' && choice.state === 'ready'))
    return undefined
  return choices.find(choice => externalBrains.some(brain => brain.id === choice.id) && choice.state === 'ready')
}
