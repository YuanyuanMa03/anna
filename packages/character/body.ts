import type { AnnaPhase } from '../shared/contracts'
import type { GestureKind } from './director'
import type { MotionCue } from './manifest'

/** Motions built into the mesh-avatar runtime, with their length in seconds (mesh-avatar 0.4 motions.js). */
export const motionSeconds = {
  nod: 1.7,
  tilt: 2.6,
  think: 3.6,
  giggle: 2.2,
  surprise: 2,
  shy: 3.2,
  no: 1.9,
  wink: 2,
  greet: 2.6,
  lookAround: 5.2,
  glance: 4.6,
  sway: 7,
  sigh: 5.6,
  doze: 7.2,
  stretch: 6.2,
  lean: 4.8,
  hum: 5.6,
  tap: 5,
  readNote: 2.6,
  waiting: 6.4,
  spaceOut: 7.4,
} as const
export type BodyMotion = keyof typeof motionSeconds
/** The runtime's live expressions, layered over motions and lip sync. */
export type BodyExpression = 'neutral' | 'smile' | 'shy' | 'surprise' | 'halfLidded' | 'angry' | 'sad' | 'wink'
/** Where she looks: at the person's pointer, wherever her idle wandering takes her, or a fixed direction (-1..1, up is +y). */
export type Look = 'person' | 'free' | { x: number, y: number }
/** Head offsets in degrees: x turns toward image right, y lifts the chin, z rolls. */
export interface Head { x?: number, y?: number, z?: number }

/** How she carries herself while the runtime is in one phase. */
export interface Beat {
  expression: BodyExpression
  /** Played once when the phase begins. */
  enter?: BodyMotion
  /** Played again every `every` ms while the phase lasts, once the previous motion has finished. */
  repeat?: { motion: BodyMotion, every: number }
  look: Look
  head?: Head
  /** Lets the runtime's own idle wandering and small idle motions play. */
  idle: boolean
}

export const beats: Record<AnnaPhase, Beat> = {
  offline: { expression: 'halfLidded', enter: 'doze', repeat: { motion: 'doze', every: 9000 }, look: { x: 0, y: -0.5 }, head: { y: -6 }, idle: false },
  idle: { expression: 'neutral', look: 'person', idle: true },
  thinking: { expression: 'neutral', enter: 'think', repeat: { motion: 'think', every: 4200 }, look: { x: -0.6, y: 0.55 }, head: { x: -8, y: 6, z: 5 }, idle: false },
  // Talking to the person: eye contact; the runtime nods along with her voice.
  responding: { expression: 'neutral', look: { x: 0, y: 0 }, idle: false },
  inspecting: { expression: 'neutral', enter: 'readNote', repeat: { motion: 'readNote', every: 3600 }, look: { x: 0.15, y: -0.6 }, head: { y: -6 }, idle: false },
  editing: { expression: 'neutral', enter: 'readNote', repeat: { motion: 'readNote', every: 5200 }, look: { x: 0.25, y: -0.55 }, head: { x: 5, y: -8 }, idle: false },
  running: { expression: 'neutral', enter: 'glance', repeat: { motion: 'glance', every: 7000 }, look: { x: 0.5, y: -0.2 }, head: { x: 10, y: -3 }, idle: false },
  testing: { expression: 'neutral', enter: 'readNote', repeat: { motion: 'readNote', every: 4500 }, look: { x: 0.5, y: -0.25 }, head: { x: 10, y: -4 }, idle: false },
  // Watching a collaborator work: half turned toward its card, an occasional nod.
  supervising: { expression: 'neutral', repeat: { motion: 'nod', every: 6500 }, look: { x: 0.55, y: -0.1 }, head: { x: 10, z: -3 }, idle: false },
  reviewing: { expression: 'neutral', enter: 'readNote', repeat: { motion: 'readNote', every: 3600 }, look: { x: 0.2, y: -0.55 }, head: { y: -7, z: -3 }, idle: false },
  // Asking the person: a questioning tilt and eye contact until they answer.
  waiting: { expression: 'neutral', enter: 'tilt', repeat: { motion: 'tilt', every: 7000 }, look: { x: 0, y: 0 }, head: { z: -7 }, idle: false },
  compacting: { expression: 'halfLidded', enter: 'spaceOut', repeat: { motion: 'spaceOut', every: 8000 }, look: { x: -0.3, y: 0.3 }, idle: false },
  retrying: { expression: 'neutral', enter: 'no', repeat: { motion: 'think', every: 5000 }, look: { x: -0.3, y: 0.2 }, head: { z: 5 }, idle: false },
  done: { expression: 'smile', enter: 'nod', look: { x: 0, y: 0 }, idle: false },
  failed: { expression: 'sad', enter: 'sigh', look: { x: 0.1, y: -0.45 }, head: { y: -5 }, idle: false },
}

/** A one-off reaction: a motion and, optionally, a face held for `hold` ms (default: the motion's length). */
interface Reaction { motion: BodyMotion, expression?: BodyExpression, hold?: number }
export type Touch = 'head' | 'face' | 'hands' | 'body'
const touches: Record<Touch, Reaction> = {
  head: { motion: 'shy', expression: 'shy' },
  face: { motion: 'giggle', expression: 'smile' },
  hands: { motion: 'nod' },
  body: { motion: 'surprise' },
}
const wink: Reaction = { motion: 'wink', expression: 'wink' }
const pout: Reaction = { motion: 'no', expression: 'angry' }
const wake: Reaction = { motion: 'greet' }
const cues: Record<MotionCue, Reaction> = {
  greet: { motion: 'greet' },
  // Handing over an approval: a questioning tilt, not a nod that reads as "done".
  present: { motion: 'tilt' },
  celebrate: { motion: 'giggle', expression: 'smile', hold: 2500 },
  review: { motion: 'readNote' },
}
const gestures: Record<GestureKind, Reaction> = { nod: { motion: 'nod' }, tilt: { motion: 'tilt' }, shake: { motion: 'no' } }

/** Alone this long while idle, she dozes off. */
const drowsyMs = 90_000
const dozeEvery = 9000
/** A pointer that moved this recently is followed; after that her gaze wanders on its own. */
const followMs = 4000
/** Three pokes inside this window earn a pout. */
const pokeMs = 2500

export interface BodyInput {
  /** When the pointer last moved over the window (ms). */
  pointerAt: number
  /** When the person last did anything: moved, clicked or typed (ms). */
  activeAt: number
  /** The person is typing to her. */
  listening: boolean
}
export interface BodyFrame {
  expression: BodyExpression
  /** A motion to start this frame. */
  motion?: BodyMotion
  look: Look
  head: Head
  idle: boolean
}

/**
 * Turns her performed phase and the person's presence into a body language: one motion at a time,
 * a working motion repeated while a phase lasts, reactions to touch and stage cues, dozing when left alone.
 */
export class BodyDirector {
  private phase?: AnnaPhase
  private repeatAt = Number.POSITIVE_INFINITY
  private busyUntil = 0
  private reactingUntil = 0
  private queued?: Reaction
  private face?: { expression: BodyExpression, until: number }
  private pokes: number[] = []
  private dozing = false
  private listening = false

  touch(region: Touch, now: number, double = false) {
    // A double click arrives after its two clicks: it is one gesture, not a third poke.
    if (double) {
      this.pokes = []
      return this.queue(region === 'face' ? wink : touches[region], now)
    }
    this.pokes = [...this.pokes.filter(at => now - at < pokeMs), now]
    if (this.pokes.length >= 3) {
      this.pokes = []
      return this.queue(pout, now)
    }
    this.queue(touches[region], now)
  }

  cue(kind: MotionCue, now: number) { this.queue(cues[kind], now) }
  gesture(kind: GestureKind, now: number) { this.queue(gestures[kind], now) }

  frame(phase: AnnaPhase, now: number, input: BodyInput): BodyFrame {
    const beat = beats[phase]
    let motion: BodyMotion | undefined
    if (phase !== this.phase) {
      // Appearing, or waking from offline into idle, she greets whoever is there. A reaction still playing
      // (a touch, a celebration) is not cut short by the next phase's entry motion.
      const greeting = (this.phase === undefined || this.phase === 'offline') && phase === 'idle'
      motion = now < this.reactingUntil ? undefined : greeting ? wake.motion : beat.enter
      this.phase = phase
      this.repeatAt = beat.repeat ? now + beat.repeat.every : Number.POSITIVE_INFINITY
    }
    const listening = input.listening && phase === 'idle'
    const alone = phase === 'idle' && !listening && now - input.activeAt >= drowsyMs
    if (alone && !this.dozing) {
      this.dozing = true
      motion = 'doze'
      this.repeatAt = now + dozeEvery
    }
    else if (!alone && this.dozing) {
      this.dozing = false
      this.repeatAt = beat.repeat ? now + beat.repeat.every : Number.POSITIVE_INFINITY
      this.queue(wake, now)
    }
    if (listening && !this.listening)
      motion ??= 'tilt'
    this.listening = listening
    if (this.queued) {
      motion = this.queued.motion
      this.queued = undefined
      this.reactingUntil = now + motionSeconds[motion] * 1000
    }
    else if (!motion && now >= this.repeatAt && now >= this.busyUntil) {
      motion = this.dozing ? 'doze' : beat.repeat!.motion
      this.repeatAt = now + (this.dozing ? dozeEvery : beat.repeat!.every)
    }
    if (motion)
      this.busyUntil = now + motionSeconds[motion] * 1000

    const held = this.face && now < this.face.until ? this.face.expression : undefined
    let look = beat.look
    let head = beat.head ?? {}
    if (this.dozing) {
      look = { x: 0, y: -0.5 }
      head = { y: -8 }
    }
    else if (listening) {
      // She looks down at what is being typed, leaning in a little.
      look = { x: 0, y: -0.45 }
      head = { y: -4, z: 4 }
    }
    else if (phase === 'idle') {
      look = now - input.pointerAt < followMs ? 'person' : 'free'
    }
    // While the person moves around she attends to them; her own idle motions resume once they rest.
    return { expression: held ?? (this.dozing ? 'halfLidded' : beat.expression), motion, look, head, idle: beat.idle && !this.dozing && !listening && look !== 'person' }
  }

  private queue(reaction: Reaction, now: number) {
    this.queued = reaction
    if (reaction.expression)
      this.face = { expression: reaction.expression, until: now + (reaction.hold ?? motionSeconds[reaction.motion] * 1000) }
  }
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/**
 * Runtime parameters for a look: gaze leads, the head follows part of the way, plus the beat's head offset.
 * `pointer` is the pointer's offset from her face in stage pixels; `reach` is the distance that reads as "far".
 */
export function aim(look: Look, head: Head = {}, pointer?: { dx: number, dy: number, reach: number }) {
  let x = 0
  let y = 0
  if (look === 'person' && pointer) {
    x = pointer.dx / pointer.reach
    y = -pointer.dy / pointer.reach
  }
  else if (typeof look === 'object') {
    x = look.x
    y = look.y
  }
  const gazeX = clamp(x * 1.2, -1, 1)
  const gazeY = clamp(y * 1.2, -1, 1)
  return {
    gazeX,
    gazeY,
    angleX: clamp(gazeX * 14 + (head.x ?? 0), -30, 30),
    angleY: clamp(gazeY * 10 + (head.y ?? 0), -30, 30),
    angleZ: clamp((head.z ?? 0) - gazeX * gazeY * 6, -30, 30),
  }
}

const syllablesPerSecond = 6.5
/** Spoken phrases: this many syllables, then a breath of `breath` syllables. */
const phrase = 12
const breath = 2
function hash(n: number) {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}
/**
 * A voice level (0..1) at `t` seconds for text being read out without audio: one rise and fall per syllable,
 * syllables of varying stress, and a short breath between phrases. Feeds the runtime's lip sync.
 */
export function voiceAt(t: number) {
  const beat = t * syllablesPerSecond
  const index = Math.floor(beat)
  if (index % (phrase + breath) >= phrase)
    return 0
  const stress = 0.6 + 0.4 * hash(index)
  return Math.sin(Math.PI * (beat - index)) ** 1.5 * stress
}

export interface Box { x0: number, y0: number, x1: number, y1: number }
/**
 * Scale and offset (stage pixels per image pixel) that fit the `crop` of her image inside the stage: her figure as
 * large as fits, her arms resting `bottom` pixels above the bottom edge, centred at `align` of the width but never
 * pushed past an edge.
 */
export function frameBody(stage: { width: number, height: number }, crop: Box, align: number, bottom = 0) {
  const floor = stage.height - bottom
  const scale = Math.min(stage.width / (crop.x1 - crop.x0), floor / (crop.y1 - crop.y0))
  const centre = stage.width * align - ((crop.x0 + crop.x1) / 2) * scale
  const left = clamp(centre, -crop.x0 * scale, stage.width - crop.x1 * scale)
  return { scale, left, top: floor - crop.y1 * scale }
}

export interface Ellipse { cx: number, cy: number, rx: number, ry: number }
export type BodyRegions = Record<Touch, Ellipse>
/** Touchable regions in image pixels, from the rig's head, eyes, mouth and chest and the hands from the manifest. */
export function bodyRegions(rig: { head: Ellipse, face: { eyeA: Ellipse, eyeB: Ellipse, mouth: Ellipse }, body: { chest: Ellipse } }, hands: Ellipse): BodyRegions {
  const { eyeA, eyeB, mouth } = rig.face
  const left = Math.min(eyeA.cx - eyeA.rx, eyeB.cx - eyeB.rx)
  const right = Math.max(eyeA.cx + eyeA.rx, eyeB.cx + eyeB.rx)
  const top = Math.min(eyeA.cy - eyeA.ry, eyeB.cy - eyeB.ry)
  const bottom = mouth.cy + mouth.ry
  const { chest } = rig.body
  return {
    face: { cx: (left + right) / 2, cy: (top + bottom) / 2, rx: (right - left) / 2 + 20, ry: (bottom - top) / 2 + 25 },
    hands,
    head: rig.head,
    // The chest ellipse widened to take in the shoulders and sleeves.
    body: { ...chest, rx: chest.rx * 1.6 },
  }
}

const inside = (e: Ellipse, p: { x: number, y: number }) => ((p.x - e.cx) / e.rx) ** 2 + ((p.y - e.cy) / e.ry) ** 2 <= 1
/** Which part of her a point (image pixels) touches; the face wins over the hair around it. */
export function regionAt(regions: BodyRegions, point: { x: number, y: number }): Touch | undefined {
  return (['face', 'hands', 'head', 'body'] as const).find(region => inside(regions[region], point))
}
