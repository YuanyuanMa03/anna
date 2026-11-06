import type { AnnaPhase } from '../packages/shared/contracts'
import { describe, expect, it } from 'vitest'
import { aim, beats, BodyDirector, bodyRegions, frameBody, headPoint, motionSeconds, regionAt } from '../packages/character/body'

const awake = (now: number) => ({ pointerAt: now, activeAt: now, listening: false })
/** Runs the director frame by frame and collects the motions it starts. */
function run(director: BodyDirector, phase: AnnaPhase, from: number, to: number, input = awake) {
  const motions: { at: number, motion: string }[] = []
  for (let now = from; now <= to; now += 50) {
    const frame = director.frame(phase, now, input(now))
    if (frame.motion)
      motions.push({ at: now, motion: frame.motion })
  }
  return motions
}

describe('body beats', () => {
  it('gives every runtime phase a beat whose motions the runtime knows', () => {
    for (const beat of Object.values(beats)) {
      for (const motion of [beat.enter, beat.repeat?.motion].filter(Boolean))
        expect(motionSeconds[motion!]).toBeGreaterThan(0)
    }
  })
  it('looks at the person while asking them, and away while thinking', () => {
    expect(beats.waiting.look).toEqual({ x: 0, y: expect.closeTo(0, 1) })
    expect(beats.thinking.look).toMatchObject({ x: expect.any(Number), y: expect.any(Number) })
    const thinking = beats.thinking.look as { x: number, y: number }
    expect(thinking.y).toBeGreaterThan(0.3)
  })
})

describe('body director', () => {
  it('greets the person when she wakes from offline into idle', () => {
    const director = new BodyDirector()
    expect(director.frame('offline', 0, awake(0)).motion).toBe('doze')
    expect(director.frame('idle', 1000, awake(1000)).motion).toBe('greet')
  })
  it('greets the person when she first appears', () => {
    expect(new BodyDirector().frame('idle', 0, awake(0)).motion).toBe('greet')
  })
  it('lets a reaction finish instead of cutting it with the next phase entry', () => {
    const director = new BodyDirector()
    director.frame('editing', 0, awake(0))
    director.cue('celebrate', 3000)
    expect(director.frame('editing', 3010, awake(3010)).motion).toBe('giggle')
    expect(director.frame('done', 3700, awake(3700))).toMatchObject({ motion: undefined, expression: 'smile' })
  })
  it('asks with a tilt when she hands over an approval', () => {
    const director = new BodyDirector()
    director.frame('waiting', 0, awake(0))
    director.cue('present', 100)
    expect(director.frame('waiting', 150, awake(150)).motion).toBe('tilt')
  })
  it('starts a phase with its entry motion, then repeats its working motion', () => {
    const motions = run(new BodyDirector(), 'thinking', 0, 30000)
    expect(motions[0]).toEqual({ at: 0, motion: 'think' })
    expect(motions.length).toBeGreaterThanOrEqual(2)
    expect(motions.every(item => item.motion === 'think')).toBe(true)
  })
  it('never starts a repeat while the previous motion is still playing', () => {
    const motions = run(new BodyDirector(), 'inspecting', 0, 12000)
    for (let index = 1; index < motions.length; index++)
      expect(motions[index]!.at - motions[index - 1]!.at).toBeGreaterThanOrEqual(motionSeconds[motions[index - 1]!.motion as keyof typeof motionSeconds] * 1000)
  })
  it('reacts to a pat on the head, then goes back to the phase face', () => {
    const director = new BodyDirector()
    director.frame('idle', 0, awake(0))
    director.touch('head', 100)
    const frame = director.frame('idle', 150, awake(150))
    expect(frame.motion).toBe('shy')
    expect(frame.expression).toBe('shy')
    expect(director.frame('idle', 6000, awake(6000)).expression).toBe('neutral')
  })
  it('giggles when her cheek is poked and winks on a double click', () => {
    const director = new BodyDirector()
    director.touch('face', 0)
    expect(director.frame('idle', 10, awake(10)).motion).toBe('giggle')
    director.touch('face', 5000, true)
    expect(director.frame('idle', 5010, awake(5010))).toMatchObject({ motion: 'wink', expression: 'wink' })
    director.touch('hands', 9000, true)
    expect(director.frame('idle', 9010, awake(9010)).motion).toBe('wink')
  })
  it('tells the stage how long a mode gesture plays', () => {
    expect(new BodyDirector().gesture('shake', 0)).toBe(motionSeconds.no * 1000)
  })
  it('pouts when poked three times in a row', () => {
    const director = new BodyDirector()
    for (const at of [0, 400, 800])
      director.touch('face', at)
    expect(director.frame('idle', 850, awake(850))).toMatchObject({ motion: 'no', expression: 'angry' })
  })
  it('dozes off after a long while alone and greets the person who comes back', () => {
    const director = new BodyDirector()
    const away = () => ({ pointerAt: 0, activeAt: 0, listening: false })
    const motions = run(director, 'idle', 0, 130_000, away)
    expect(motions.some(item => item.motion === 'doze')).toBe(true)
    expect(director.frame('idle', 130_050, away()).expression).toBe('halfLidded')
    const back = director.frame('idle', 130_100, awake(130_100))
    expect(back.motion).toBe('greet')
    expect(director.frame('idle', 130_150, awake(130_150)).expression).not.toBe('halfLidded')
  })
  it('does not doze while she is working', () => {
    const motions = run(new BodyDirector(), 'editing', 0, 130_000, () => ({ pointerAt: 0, activeAt: 0, listening: false }))
    expect(motions.some(item => item.motion === 'doze')).toBe(false)
  })
  it('tilts her head and looks down at what the person is typing', () => {
    const director = new BodyDirector()
    director.frame('idle', 0, awake(0))
    const frame = director.frame('idle', 50, { pointerAt: 50, activeAt: 50, listening: true })
    expect(frame.motion).toBe('tilt')
    expect(frame.look).toMatchObject({ y: expect.any(Number) })
    expect((frame.look as { y: number }).y).toBeLessThan(0)
    expect(frame.idle).toBe(false)
  })
  it('follows a moving pointer when idle and lets her gaze wander once it rests', () => {
    const director = new BodyDirector()
    expect(director.frame('idle', 1000, awake(1000))).toMatchObject({ look: 'person', idle: false })
    expect(director.frame('idle', 9000, { pointerAt: 1000, activeAt: 9000, listening: false })).toMatchObject({ look: 'free', idle: true })
  })
  it('breaks eye contact even while the pointer keeps moving, then can attend again', () => {
    const director = new BodyDirector()
    expect(director.frame('idle', 0, awake(0)).look).toBe('person')
    expect(director.frame('idle', 2000, awake(2000)).look).toBe('free')
    expect(director.frame('idle', 5000, awake(5000)).look).toBe('free')
    expect(director.frame('idle', 7000, awake(7000)).look).toBe('person')
  })
  it('leaves quiet time between work gestures and asks for approval only once', () => {
    const motions = run(new BodyDirector(), 'thinking', 0, 30000)
    for (let index = 1; index < motions.length; index++)
      expect(motions[index]!.at - motions[index - 1]!.at - motionSeconds.think * 1000).toBeGreaterThanOrEqual(8000)
    expect(run(new BodyDirector(), 'waiting', 0, 30000)).toEqual([{ at: 0, motion: 'tilt' }])
  })
  it('turns stage cues and mode gestures into motions', () => {
    const director = new BodyDirector()
    director.cue('celebrate', 0)
    expect(director.frame('done', 10, awake(10))).toMatchObject({ motion: 'giggle', expression: 'smile' })
    director.gesture('shake', 5000)
    expect(director.frame('idle', 5010, awake(5010)).motion).toBe('no')
    director.gesture('tilt', 9000)
    expect(director.frame('idle', 9010, awake(9010)).motion).toBe('tilt')
  })
})

describe('body aim', () => {
  it('looks toward the pointer, up and to the right', () => {
    const params = aim('person', {}, { dx: 300, dy: -200, reach: 600 })
    expect(params.gazeX).toBeGreaterThan(0)
    expect(params.gazeY).toBeGreaterThan(0)
    expect(params.angleX).toBeGreaterThan(0)
    expect(params.angleY).toBeGreaterThan(0)
  })
  it('keeps the head and eyes inside their range for a far pointer', () => {
    const params = aim('person', {}, { dx: -9000, dy: 9000, reach: 600 })
    expect(params.gazeX).toBe(-0.55)
    expect(params.gazeY).toBe(-0.4)
    expect(Math.abs(params.angleX)).toBeLessThanOrEqual(6)
    expect(Math.abs(params.angleY)).toBeLessThanOrEqual(4)
  })
  it('adds the beat head offset to a fixed look', () => {
    const params = aim({ x: 0, y: 0 }, { z: -7 })
    expect(params).toMatchObject({ gazeX: 0, gazeY: 0, angleZ: -3 })
  })
})

describe('body framing', () => {
  const crop = { x0: 330, y0: 30, x1: 1350, y1: 906 }
  it('fits her figure inside the stage with her arms on its bottom edge', () => {
    const frame = frameBody({ width: 700, height: 800 }, crop, 0.5)
    expect((crop.x1 - crop.x0) * frame.scale).toBeLessThanOrEqual(700.01)
    expect(frame.top + crop.y1 * frame.scale).toBeCloseTo(800)
    expect(frame.left + ((crop.x0 + crop.x1) / 2) * frame.scale).toBeCloseTo(350)
  })
  it('leaves room under her arms for the status ribbon', () => {
    const frame = frameBody({ width: 700, height: 800 }, crop, 0.5, 46)
    expect(frame.top + crop.y1 * frame.scale).toBeCloseTo(754)
    expect((crop.y1 - crop.y0) * frame.scale).toBeLessThanOrEqual(754.01)
  })
  it('places her where `align` asks, within the stage', () => {
    const frame = frameBody({ width: 1600, height: 600 }, crop, 0.62)
    expect(frame.left + ((crop.x0 + crop.x1) / 2) * frame.scale).toBeCloseTo(992)
    expect(frame.top + crop.y1 * frame.scale).toBeCloseTo(600)
  })
})

describe('head point', () => {
  const head = { pivotX: 810, pivotY: 516, shiftX: 45, shiftY: 24, maxRoll: 0.15 }
  it('leaves her mouth where it is drawn at rest', () => {
    expect(headPoint({ x: 816, y: 394 }, head, {})).toEqual({ x: 816, y: 394 })
  })
  it('moves her mouth with a head turn, a nod and a roll', () => {
    expect(headPoint({ x: 816, y: 394 }, head, { angleX: 30 }).x).toBeCloseTo(861)
    expect(headPoint({ x: 816, y: 394 }, head, { angleY: -30 }).y).toBeCloseTo(418)
    const rolled = headPoint({ x: 816, y: 394 }, head, { angleZ: 30 })
    expect(Math.hypot(rolled.x - 810, rolled.y - 516)).toBeCloseTo(Math.hypot(6, 122))
    expect(rolled.x).not.toBeCloseTo(816)
  })
})

describe('body regions', () => {
  const rig = {
    head: { cx: 840, cy: 280, rx: 360, ry: 245 },
    face: { eyeA: { cx: 778, cy: 298, rx: 43, ry: 28 }, eyeB: { cx: 885, cy: 316, rx: 43, ry: 28 }, mouth: { cx: 817, cy: 399, rx: 49, ry: 29 } },
    body: { chest: { cx: 820, cy: 677, rx: 212, ry: 145 } },
  }
  const regions = bodyRegions(rig, { cx: 865, cy: 850, rx: 190, ry: 55 })
  it('tells her cheek from her hair, her hands and the empty air around her', () => {
    expect(regionAt(regions, { x: 760, y: 345 })).toBe('face')
    expect(regionAt(regions, { x: 840, y: 120 })).toBe('head')
    expect(regionAt(regions, { x: 870, y: 850 })).toBe('hands')
    expect(regionAt(regions, { x: 820, y: 650 })).toBe('body')
    expect(regionAt(regions, { x: 40, y: 40 })).toBeUndefined()
  })
})
