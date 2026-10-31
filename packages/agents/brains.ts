import type { Settings } from '../shared/contracts'

export type BrainId = Settings['kernel']
/** ready: can think now · signed-out: installed but not logged in · missing: not installed · needs-key: pi has no model yet. */
export type BrainState = 'ready' | 'signed-out' | 'missing' | 'needs-key'
export interface BrainChoice { id: BrainId, label: string, state: BrainState, note: string, current: boolean }

/** Agents that can be her brain, besides pi, and the catalogued agent each one runs. */
const agents: { id: Exclude<BrainId, 'pi'>, agent: string, label: string }[] = [
  { id: 'claude-code', agent: 'claude', label: 'Claude Code' },
  { id: 'codex', agent: 'codex', label: 'Codex' },
]

/** Every brain she could think with on this machine, pi first, each with what stands between it and thinking. */
export function brainChoices(input: { detected: { id: string, installed: boolean, version?: string, loggedIn?: boolean }[], current: BrainId, hasKey: boolean }): BrainChoice[] {
  const pi: BrainChoice = { id: 'pi', label: 'pi', state: input.hasKey ? 'ready' : 'needs-key', note: input.hasKey ? '内置 · 用你配置的模型' : '内置 · 还没配置模型', current: input.current === 'pi' }
  return [pi, ...agents.map(({ id, agent, label }) => {
    const info = input.detected.find(item => item.id === agent)
    const version = `v${info?.version ?? '?'}`
    // A login that cannot be checked (no status command) counts as ready; the brain reports its own errors.
    const state: BrainState = !info?.installed ? 'missing' : info.loggedIn === false ? 'signed-out' : 'ready'
    const note = state === 'missing' ? '未安装' : state === 'signed-out' ? `${version} · 未登录` : version
    return { id, label, state, note, current: input.current === id }
  })]
}

/** For someone whose pi has no model yet: the first agent that is installed and signed in, so one click starts her. */
export function recommendedBrain(choices: BrainChoice[]) {
  if (choices.some(choice => choice.id === 'pi' && choice.state === 'ready'))
    return undefined
  return choices.find(choice => choice.id !== 'pi' && choice.state === 'ready')
}
