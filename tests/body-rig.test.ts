import type { Rig } from 'mesh-avatar'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { followBodyLook, stabilizeBodyRig } from '../packages/character/body-rig'

// Synthetic geometry for engineering regression; not Anna's private illustration or rig.
const ellipse = (cx: number, cy: number, rx = 35, ry = 25) => ({ cx, cy, rx, ry })
const eye = (x: number) => ({ opening: [], roi: [], x0: x - 20, x1: x + 20, top: Array.from({ length: 24 }, () => 290), bot: Array.from({ length: 24 }, () => 310) })
const fixture: Rig = {
  version: 1,
  image: { width: 1000, height: 1000 },
  head: { ...ellipse(500, 280, 300, 240), shiftX: 45, shiftY: 24, pivotX: 500, pivotY: 516, maxRoll: 0.15, weightBand: [455, 540], turnBand: [455, 570] },
  body: { pivotX: 500, pivotY: 900, maxRoll: 0.035, breathBand: [565, 840], rollBand: [535, 865], chest: ellipse(500, 670, 200, 140), shoulders: [] },
  face: { nose: ellipse(500, 350), mouth: ellipse(500, 400), eyeA: ellipse(440, 300), eyeB: ellipse(560, 300), earL: ellipse(390, 330), earR: ellipse(610, 330), brow: { ...ellipse(500, 270, 100, 20), band: [285, 305] }, jaw: { ...ellipse(500, 435, 60, 25), band: [415, 444] } },
  eyes: [eye(440), eye(560)],
  mouth: { cx: 500, cy: 400, halfLen: 35, angle: 0, bow: 0, area: { ...ellipse(500, 402, 49, 26), angle: 0 } },
  cheeks: [[430, 345], [570, 345]],
  strands: [{ name: 'toy-hair', nodes: [[350, 200], [330, 300], [320, 400], [310, 500]], sigma: 20, k: 1, max: 10 }],
  mesh: { baseCell: 14, fine: { x0: 250, x1: 750, y0: 40, y1: 650, cell: 7 }, eyeBallCell: 4, eyeCell: 3, spriteCell: 4, handCell: 9, tasselCell: 6 },
  view: { padTop: 0, padSide: 0 },
}

describe('portrait binding', () => {
  it('preserves archive geometry and eye/mouth registration', () => {
    const before = structuredClone(fixture)
    const stable = stabilizeBodyRig(fixture)
    expect(fixture).toEqual(before)
    expect(stable.eyes).toEqual(fixture.eyes)
    expect(stable.mouth).toEqual(fixture.mouth)
    expect(stable).not.toBe(fixture)
  })
  it('preserves skull distances in the installed deformation kernel at large turns', async () => {
    // Pinning the kernel name intentionally makes an engine upgrade require re-review.
    const js = readFileSync(new URL('../node_modules/mesh-avatar/dist/index.js', import.meta.url), 'utf8')
    const url = `data:text/javascript;base64,${Buffer.from(`${js}\nexport {xn as kernel,Ge as params};`).toString('base64')}`
    const { kernel, params } = await import(/* @vite-ignore */ url)
    const p = { ...Object.fromEntries(params.map((v: { id: string, def: number }) => [v.id, v.def])), angleX: 25, angleY: -20, angleZ: 12 }
    const transform = (rig: Rig, point: number[]) => {
      const engine = kernel(rig)
      const out: number[] = []
      engine.deformBase(point[0], point[1], engine.baseWeights(...point, 0), p, { gain: 0, bunL: [0, 0], bunR: [0, 0] }, out)
      return out
    }
    const pairs = [[[400, 330], [410, 330]], [[580, 330], [590, 330]], [[470, 370], [470, 380]]]
    let originalStrain = 0
    for (const [a, b] of pairs) {
      const distance = (rig: Rig) => { const x = transform(rig, a!); const y = transform(rig, b!); return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!) }
      originalStrain = Math.max(originalStrain, Math.abs(distance(fixture) - 10))
      expect(Math.abs(distance(stabilizeBodyRig(fixture)) - 10)).toBeLessThan(0.05)
    }
    expect(originalStrain).toBeGreaterThan(0.1)
  })
  it('still nods and follows: the whole face moves, as one piece', async () => {
    const js = readFileSync(new URL('../node_modules/mesh-avatar/dist/index.js', import.meta.url), 'utf8')
    const url = `data:text/javascript;base64,${Buffer.from(`${js}\nexport {xn as kernel,Ge as params};`).toString('base64')}`
    const { kernel, params } = await import(/* @vite-ignore */ url)
    const engine = kernel(stabilizeBodyRig(fixture))
    const moved = (point: number[], pose: Record<string, number>) => {
      const p = { ...Object.fromEntries(params.map((v: { id: string, def: number }) => [v.id, v.def])), ...pose }
      const out: number[] = []
      engine.deformBase(point[0], point[1], engine.baseWeights(...point, 0), p, { gain: 0, bunL: [0, 0], bunR: [0, 0] }, out)
      return [out[0]! - point[0]!, out[1]! - point[1]!]
    }
    const [nose, eyeLeft, eyeRight] = [[500, 350], [440, 300], [560, 300]]
    expect(Math.abs(moved(nose!, { angleY: -15 })[1]!)).toBeGreaterThan(2.5)
    expect(Math.abs(moved(nose!, { angleX: 6 })[0]!)).toBeGreaterThan(3)
    expect(moved(eyeLeft!, { angleX: 6 })[0]).toBeCloseTo(moved(eyeRight!, { angleX: 6 })[0]!, 6)
  })
})

describe('pointer follow timing', () => {
  it('behaves consistently at 30 and 120 fps', () => {
    const run = (fps: number) => { const p = { angleX: -3, gazeX: -0.3 }; for (let i = 0; i < fps; i++) followBodyLook(p, { angleX: 3, gazeX: 0.3 }, 1 / fps); return p }
    const low = run(30); const high = run(120)
    expect(low.angleX).toBeCloseTo(high.angleX, 1)
    expect(low.gazeX).toBeCloseTo(high.gazeX, 2)
  })
  it('limits a sudden pointer reversal and a resumed background frame', () => {
    const p = { angleX: -6, gazeX: -0.55 }
    followBodyLook(p, { angleX: 6, gazeX: 0.55 }, 10)
    expect(p.angleX).toBeLessThanOrEqual(-5.4)
    expect(p.gazeX).toBeLessThanOrEqual(-0.4)
  })
})
