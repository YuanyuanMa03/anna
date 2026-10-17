import { describe, expect, it } from 'vitest'
import { approach, Director, poses } from '../packages/character/director'

describe('stage director', () => {
  it('holds a pose for its dwell before a same-priority change, but lets urgent phases cut in', () => {
    const director = new Director()
    director.update('inspecting', 0)
    expect(director.update('editing', 100)).toBe('inspecting')
    expect(director.tick(500)).toBe('inspecting')
    expect(director.tick(800)).toBe('editing')
    expect(director.update('waiting', 850)).toBe('waiting')
  })
  it('relaxes outcome poses back to idle', () => {
    const director = new Director()
    director.update('done', 0)
    expect(director.tick(1000)).toBe('done')
    expect(director.tick(5000)).toBe('idle')
  })
  it('eases toward the target pose', () => {
    const halfway = approach(poses.idle, poses.thinking, 0.5)
    expect(halfway.headZ).toBeCloseTo(poses.thinking.headZ / 2)
    expect(halfway.followPointer).toBe(false)
  })
})

describe('mode stances and gestures', () => {
  it('plan reads quietly when idle, auto moves faster', async () => {
    const { applyStance, stances } = await import('../packages/character/director')
    const plan = applyStance(poses.idle, stances.plan, 'idle')
    expect(plan.followPointer).toBe(false)
    expect(plan.gazeY).toBeLessThan(0)
    expect(applyStance(poses.editing, stances.auto, 'editing').bob).toBeGreaterThan(poses.editing.bob)
  })
  it('nods for more freedom, tilts for more supervision, and fades out', async () => {
    const { gestureForModeChange, gestureOffset } = await import('../packages/character/director')
    expect(gestureForModeChange('ask', 'auto')).toBe('nod')
    expect(gestureForModeChange('auto', 'plan')).toBe('tilt')
    expect(gestureOffset({ kind: 'tilt', start: 0 }, 700)!.headZ).toBeLessThan(-5)
    expect(gestureOffset({ kind: 'nod', start: 0 }, 2000)).toBeUndefined()
  })
})

describe('reviewing a collaborator', () => {
  it('looks down at the card in her hand and holds the pose while she thinks', async () => {
    const { Presence } = await import('../packages/anna-host/presence')
    const states: string[] = []
    const presence = new Presence(output => output.type === 'anna' && states.push(output.state.phase))
    presence.handle({ type: 'tool-start', id: '1', name: 'anna_delegate', input: { agent: 'codex', task: 'x' } })
    presence.handle({ type: 'tool-end', id: '1', name: 'anna_delegate', output: 'done', isError: false })
    presence.handle({ type: 'thinking' })
    expect(presence.state).toMatchObject({ phase: 'reviewing', line: '看看 Codex 交回来的结果…' })
    presence.handle({ type: 'text', text: '审过了。' })
    expect(states.at(-1)).toBe('responding')
    expect(poses.reviewing.scan).toBeGreaterThan(0)
  })
})
