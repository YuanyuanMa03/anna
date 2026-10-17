import type { AnnaPhase, PermissionMode } from '../shared/contracts'

/** Pose targets layered over the idle motion. Angles are degrees offsets; gaze/brow/smile are -1..1. */
export interface Pose {
  gazeX: number
  gazeY: number
  /** Follow the pointer instead of the fixed gaze. */
  followPointer: boolean
  headX: number
  headY: number
  headZ: number
  body: number
  brow: number
  smile: number
  eyeOpen: number
  /** Eye scanning amplitude, as when reading lines. */
  scan: number
  /** Rhythmic nod amplitude in degrees. */
  bob: number
}

const base: Pose = { gazeX: 0, gazeY: 0, followPointer: false, headX: 0, headY: 0, headZ: 0, body: 0, brow: 0, smile: 0.2, eyeOpen: 1, scan: 0, bob: 0 }
export const poses: Record<AnnaPhase, Pose> = {
  offline: { ...base, headY: -14, eyeOpen: 0.35, smile: 0 },
  idle: { ...base, followPointer: true, smile: 0.35 },
  thinking: { ...base, gazeX: -0.55, gazeY: 0.6, headX: -6, headY: 6, headZ: 7, brow: 0.35, smile: 0 },
  responding: { ...base, gazeX: 0, gazeY: 0.05, headZ: -2, smile: 0.55 },
  inspecting: { ...base, gazeX: 0.55, gazeY: -0.45, headX: 9, headY: -8, body: 3, scan: 0.28, smile: 0.1 },
  editing: { ...base, gazeX: 0.5, gazeY: -0.55, headX: 8, headY: -11, body: 4, brow: -0.15, bob: 2.2, smile: 0.15 },
  running: { ...base, gazeX: 0.75, gazeY: -0.1, headX: 13, headY: -3, body: 5, brow: -0.2, smile: 0 },
  testing: { ...base, gazeX: 0.75, gazeY: -0.15, headX: 14, headY: -4, body: 6, brow: -0.3, smile: 0 },
  // Watching a collaborator work: half turned toward its card, an occasional slow nod.
  supervising: { ...base, gazeX: 0.7, gazeY: -0.05, headX: 12, headZ: -3, body: 2, smile: 0.3, bob: 1.2 },
  waiting: { ...base, gazeX: 0, gazeY: 0.1, headX: -4, headZ: -9, body: -2, brow: 0.7, smile: 0.25 },
  compacting: { ...base, gazeY: -0.2, headZ: 5, eyeOpen: 0.55, smile: 0.1 },
  retrying: { ...base, gazeX: -0.3, gazeY: 0.2, headZ: 6, brow: 0.4, smile: -0.1 },
  done: { ...base, gazeY: 0.05, headY: 4, smile: 1, bob: 3 },
  failed: { ...base, gazeX: 0.2, gazeY: -0.4, headY: -7, headZ: 4, brow: 0.6, smile: -0.6 },
}

/** Higher wins immediately; equal or lower waits for the current pose's minimum dwell. */
const priority: Record<AnnaPhase, number> = { offline: 0, idle: 1, done: 2, thinking: 3, responding: 4, compacting: 4, inspecting: 5, editing: 5, running: 5, testing: 5, supervising: 5, retrying: 6, failed: 7, waiting: 9 }
const dwellMs = 700
/** Outcome poses relax back to idle after this long. */
const settleMs = 4000

/** Turns the stream of truthful runtime phases into a calm performance: no flicker, urgent states first. */
export class Director {
  phase: AnnaPhase = 'offline'
  private since = 0
  private pending?: AnnaPhase
  update(next: AnnaPhase, now: number) {
    if (next === this.phase) {
      this.pending = undefined
      return this.phase
    }
    if (priority[next] > priority[this.phase] || now - this.since >= dwellMs)
      this.switch(next, now)
    else
      this.pending = next
    return this.phase
  }

  /** Called every frame: applies a deferred phase once the dwell has passed and settles outcomes. */
  tick(now: number) {
    if (this.pending && now - this.since >= dwellMs)
      this.switch(this.pending, now)
    else if ((this.phase === 'done' || this.phase === 'failed') && now - this.since >= settleMs)
      this.switch('idle', now)
    return this.phase
  }

  private switch(phase: AnnaPhase, now: number) {
    this.phase = phase
    this.since = now
    this.pending = undefined
  }
}

/** Move the current pose a fraction toward the target each frame. */
export function approach(current: Pose, target: Pose, factor: number): Pose {
  const next: Pose = { ...target }
  const numeric = Object.keys(base).filter(key => key !== 'followPointer') as Exclude<keyof Pose, 'followPointer'>[]
  for (const key of numeric)
    next[key] = current[key] + (target[key] - current[key]) * factor
  return next
}

export function restingPose(): Pose { return { ...poses.offline } }

/**
 * How a permission mode colours every pose: plan reads quietly, ask stays attentive to the user,
 * edit is neutral, auto is brisk and confident. `tempo` scales easing and rhythmic motion.
 */
export interface Stance { offset: Partial<Record<Exclude<keyof Pose, 'followPointer'>, number>>, tempo: number, idleGaze?: { x: number, y: number } }
export const stances: Record<PermissionMode, Stance> = {
  plan: { offset: { gazeY: -0.2, headY: -4, headZ: 3, smile: -0.1, eyeOpen: -0.08 }, tempo: 0.65, idleGaze: { x: -0.35, y: -0.45 } },
  ask: { offset: { brow: 0.18, headZ: -3, body: -1 }, tempo: 0.85 },
  edit: { offset: {}, tempo: 1 },
  auto: { offset: { smile: 0.2, body: 2.5, headY: 2, brow: -0.05 }, tempo: 1.35 },
}

export function applyStance(pose: Pose, stance: Stance, phase: AnnaPhase): Pose {
  const out: Pose = { ...pose }
  for (const [key, value] of Object.entries(stance.offset) as [Exclude<keyof Pose, 'followPointer'>, number][])
    out[key] += value
  out.bob *= stance.tempo
  if (phase === 'idle' && stance.idleGaze)
    Object.assign(out, { followPointer: false, gazeX: stance.idleGaze.x, gazeY: stance.idleGaze.y })
  return out
}

/** A one-shot gesture layered on top of the pose, e.g. when the user changes the permission mode. */
export type GestureKind = 'nod' | 'tilt' | 'shake'
export interface Gesture { kind: GestureKind, start: number }
const gestureMs = 1400

/** Head offsets for a gesture at `now`, fading out; undefined when finished. */
export function gestureOffset(gesture: Gesture | undefined, now: number): { headX: number, headY: number, headZ: number, smile: number, brow: number } | undefined {
  if (!gesture)
    return undefined
  const t = (now - gesture.start) / gestureMs
  if (t < 0 || t >= 1)
    return undefined
  const fade = Math.sin(Math.PI * t)
  const wave = Math.sin(t * Math.PI * 4)
  if (gesture.kind === 'nod')
    return { headX: 0, headY: wave * 9 * fade, headZ: 0, smile: 0.5 * fade, brow: 0.1 * fade }
  if (gesture.kind === 'shake')
    return { headX: wave * 10 * fade, headY: 0, headZ: 0, smile: -0.2 * fade, brow: 0.3 * fade }
  return { headX: -4 * fade, headY: 2 * fade, headZ: -10 * fade, smile: 0.1 * fade, brow: 0.6 * fade }
}

/** More freedom earns a nod; more supervision a thoughtful tilt. */
export function gestureForModeChange(previous: PermissionMode, next: PermissionMode): GestureKind {
  const order: PermissionMode[] = ['plan', 'ask', 'edit', 'auto']
  return order.indexOf(next) > order.indexOf(previous) ? 'nod' : 'tilt'
}
