import { parseRig, validateRig } from 'mesh-avatar'
import { describe, expect, it } from 'vitest'
import { clearPlainBackground, findEye, frameFromAlpha, rigFromMarks } from '../packages/character/make-avatar'

// Rounded from Anna's own art, whose real rig these proportions were taken from.
const marks = { eyeA: { x: 778, y: 298 }, eyeB: { x: 885, y: 316 }, mouth: { x: 816, y: 394 }, chin: { x: 816, y: 445 }, top: { x: 840, y: 35 } }
const box = { cx: 0, cy: 0, rx: 28, ry: 16 }
const eyes = (a = marks.eyeA, b = marks.eyeB) => [{ ...box, cx: a.x, cy: a.y }, { ...box, cx: b.x, cy: b.y }] as const

describe('a rig from five marks', () => {
  it('passes the runtime\'s own validation, as a complete rig', () => {
    const rig = rigFromMarks({ width: 1672, height: 941 }, marks, eyes())
    expect(validateRig(rig)).toEqual([])
    expect(() => parseRig(rig)).not.toThrow()
  })

  it('keeps the runtime\'s order: eye 0 is the one on the image\'s left, whichever was clicked first', () => {
    const swapped = { ...marks, eyeA: marks.eyeB, eyeB: marks.eyeA }
    const rig = rigFromMarks({ width: 1672, height: 941 }, swapped, eyes(marks.eyeB, marks.eyeA))
    expect(rig.eyes[0]!.x0).toBeLessThan(rig.eyes[1]!.x0)
    expect(rig.face.eyeA.cx).toBeLessThan(rig.face.eyeB.cx)
    expect(validateRig(rig)).toEqual([])
  })

  it('places the head where the marks say, close to how the real rig of this art is drawn', () => {
    const { head, mouth } = rigFromMarks({ width: 1672, height: 941 }, marks, eyes())
    expect(Math.abs(head.cy - 280)).toBeLessThan(25)
    expect(Math.abs(head.ry - 245)).toBeLessThan(25)
    expect(head.pivotY).toBeGreaterThan(marks.chin.y)
    expect(mouth).toMatchObject({ cx: marks.mouth.x, cy: marks.mouth.y })
  })

  it('is still valid for a tight head shot whose body would fall outside the image', () => {
    const tight = { eyeA: { x: 80, y: 90 }, eyeB: { x: 150, y: 90 }, mouth: { x: 115, y: 150 }, chin: { x: 115, y: 185 }, top: { x: 115, y: 10 } }
    expect(validateRig(rigFromMarks({ width: 230, height: 200 }, tight, eyes(tight.eyeA, tight.eyeB)))).toEqual([])
  })

  it('refuses marks that cannot be a face, with a reason a person can act on', () => {
    expect(() => rigFromMarks({ width: 500, height: 500 }, { ...marks, eyeA: { x: 100, y: 100 }, eyeB: { x: 100, y: 100 } }, eyes())).toThrow(/眼睛/)
    expect(() => rigFromMarks({ width: 1672, height: 941 }, { ...marks, chin: { x: 816, y: 20 } }, eyes())).toThrow(/下巴/)
  })
})

/** A grey image with a dark almond at (cx, cy). */
function faceWithEye(cx: number, cy: number, rx: number, ry: number, width = 200, height = 120) {
  const luma = new Uint8ClampedArray(width * height).fill(200)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1)
        luma[y * width + x] = 40
    }
  }
  return { luma, width, height }
}

describe('finding the eye around a click', () => {
  it('fits the dark shape the click landed on', () => {
    const eye = findEye(faceWithEye(100, 60, 24, 12), { x: 103, y: 62 }, 100)
    expect(Math.abs(eye.cx - 100)).toBeLessThanOrEqual(2)
    expect(Math.abs(eye.cy - 60)).toBeLessThanOrEqual(2)
    expect(Math.abs(eye.rx - 24)).toBeLessThanOrEqual(3)
    expect(Math.abs(eye.ry - 12)).toBeLessThanOrEqual(3)
  })

  it('falls back to proportions when there is nothing dark to fit', () => {
    const blank = { luma: new Uint8ClampedArray(200 * 120).fill(200), width: 200, height: 120 }
    const eye = findEye(blank, { x: 100, y: 60 }, 100)
    expect(eye).toMatchObject({ cx: 100, cy: 60 })
    expect(eye.rx).toBeGreaterThan(10)
    expect(eye.ry).toBeGreaterThan(5)
  })

  it('does not grow into hair that touches the window', () => {
    const { luma, width, height } = faceWithEye(100, 60, 20, 10)
    for (let y = 0; y < 25; y++) {
      for (let x = 0; x < width; x++)
        luma[y * width + x] = 20
    }
    const eye = findEye({ luma, width, height }, { x: 100, y: 60 }, 100)
    expect(eye.ry).toBeLessThanOrEqual(30)
    expect(eye.cy).toBeGreaterThan(40)
  })
})

function pixels(width: number, height: number, at: (x: number, y: number) => number[]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++)
      data.set(at(x, y), (y * width + x) * 4)
  }
  return data
}

describe('clearing a plain background', () => {
  const figure = (x: number, y: number) => x >= 8 && x < 16 && y >= 8 && y < 16

  it('removes a uniform background connected to the border and keeps the figure', () => {
    const data = pixels(24, 24, (x, y) => figure(x, y) ? [200, 40, 40, 255] : [250, 250, 250, 255])
    expect(clearPlainBackground(data, 24, 24)).toBe(true)
    expect(data[3]).toBe(0)
    expect(data[(12 * 24 + 12) * 4 + 3]).toBe(255)
  })

  it('leaves a white shirt inside the figure alone: only what touches the border is background', () => {
    const data = pixels(24, 24, (x, y) => x === 12 && y === 12 ? [250, 250, 250, 255] : figure(x, y) ? [200, 40, 40, 255] : [250, 250, 250, 255])
    clearPlainBackground(data, 24, 24)
    expect(data[(12 * 24 + 12) * 4 + 3]).toBe(255)
  })

  it('does nothing to a picture that already has transparency, or a busy background', () => {
    const cut = pixels(24, 24, (x, y) => figure(x, y) ? [200, 40, 40, 255] : [0, 0, 0, 0])
    expect(clearPlainBackground(cut, 24, 24)).toBe(false)
    const busy = pixels(24, 24, (x, y) => [(x * 37) % 255, (y * 91) % 255, (x * y * 13) % 255, 255])
    const before = busy.slice()
    expect(clearPlainBackground(busy, 24, 24)).toBe(false)
    expect(busy).toEqual(before)
  })
})

describe('framing her on the stage', () => {
  it('crops to what is drawn and puts her hands at the bottom of it', () => {
    const data = pixels(100, 100, (x, y) => x >= 20 && x < 80 && y >= 10 && y < 90 ? [1, 2, 3, 255] : [0, 0, 0, 0])
    const { crop, hands } = frameFromAlpha(data, 100, 100)
    expect(crop).toEqual({ x0: 20, y0: 10, x1: 80, y1: 90 })
    expect(hands.cx).toBe(50)
    expect(hands.cy).toBeGreaterThan(70)
    expect(hands.cy).toBeLessThanOrEqual(90)
  })

  it('frames the whole picture when nothing is transparent', () => {
    const { crop } = frameFromAlpha(pixels(30, 40, () => [9, 9, 9, 255]), 30, 40)
    expect(crop).toEqual({ x0: 0, y0: 0, x1: 30, y1: 40 })
  })
})
