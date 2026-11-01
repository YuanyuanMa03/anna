import type { Rig } from 'mesh-avatar'
import type { Box, Ellipse } from './manifest'

/**
 * A mesh avatar from one picture and five clicks: what the person gives Anna to make their own her.
 * Studio's agent guide builds a far finer rig over tens of minutes; this one takes a second and needs no tools, so it
 * reads only what clicks can tell. The proportions are measured from Anna's own rig. Pure geometry here, canvas in build.
 */
export interface Point { x: number, y: number }
export interface FaceMarks { eyeA: Point, eyeB: Point, mouth: Point, chin: Point, top: Point }
export interface Gray { luma: Uint8ClampedArray, width: number, height: number }

/** Largest side of the picture she works from; larger only costs memory on stage. */
export const maxSide = 1536

const samples = 24

function ellipsePoints({ cx, cy, rx, ry }: Ellipse, count: number): [number, number][] {
  return Array.from({ length: count }, (_, k) => {
    const angle = (k / count) * Math.PI * 2 + Math.PI
    return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]
  })
}

function eyeOf(eye: Ellipse): Rig['eyes'][number] {
  const curve = (sign: number) => Array.from({ length: samples }, (_, k) => {
    const u = (k / (samples - 1)) * 2 - 1
    return eye.cy + sign * eye.ry * Math.sqrt(Math.max(0, 1 - u * u))
  })
  return {
    opening: ellipsePoints(eye, 16),
    roi: ellipsePoints({ ...eye, rx: eye.rx * 1.4, ry: eye.ry * 1.6 }, 16),
    x0: eye.cx - eye.rx,
    x1: eye.cx + eye.rx,
    top: curve(-1),
    bot: curve(1),
  }
}

/** The complete rig for a face the person has marked. Throws, in words they can act on, if the marks are not a face. */
export function rigFromMarks(size: { width: number, height: number }, marks: FaceMarks, eyes: readonly [Ellipse, Ellipse]): Rig {
  const distance = Math.hypot(marks.eyeB.x - marks.eyeA.x, marks.eyeB.y - marks.eyeA.y)
  if (distance < 8)
    throw new Error('两只眼睛点得太近了，请重新点一次。')
  const height = marks.chin.y - marks.top.y
  if (height < distance || marks.chin.y <= marks.mouth.y || marks.mouth.y <= Math.min(marks.eyeA.y, marks.eyeB.y))
    throw new Error('嘴巴、下巴和头顶的位置对不上，请确认下巴在嘴巴下面、头顶在眼睛上面。')
  const [left, right] = marks.eyeA.x <= marks.eyeB.x ? [eyes[0], eyes[1]] : [eyes[1], eyes[0]]
  const middle = (left.cx + right.cx) / 2
  const eyeLine = (left.cy + right.cy) / 2
  const tilt = Math.atan2(right.cy - left.cy, right.cx - left.cx)
  const { chin, mouth } = marks
  const clampX = (x: number) => Math.round(Math.min(size.width, Math.max(0, x)))
  const clampY = (y: number) => Math.round(Math.min(size.height, Math.max(0, y)))
  const nose = { x: middle + (mouth.x - middle) * 0.65, y: eyeLine + (mouth.y - eyeLine) * 0.65 }
  return {
    version: 1,
    image: { width: size.width, height: size.height },
    head: {
      cx: middle,
      cy: marks.top.y + height * 0.6,
      rx: height * 0.8,
      ry: height * 0.6,
      shiftX: height * 0.11,
      shiftY: height * 0.06,
      pivotX: mouth.x,
      pivotY: chin.y + height * 0.17,
      maxRoll: 0.15,
      weightBand: [chin.y + height * 0.025, chin.y + height * 0.23],
      turnBand: [chin.y + height * 0.025, chin.y + height * 0.3],
    },
    body: {
      pivotX: middle,
      pivotY: Math.min(size.height * 0.96, chin.y + height * 1.1),
      maxRoll: 0.035,
      breathBand: [chin.y + height * 0.29, chin.y + height * 0.96],
      rollBand: [chin.y + height * 0.22, chin.y + height * 1.02],
      chest: { cx: middle, cy: chin.y + height * 0.57, rx: height * 0.52, ry: height * 0.35 },
      shoulders: [
        { cx: middle - height * 0.58, cy: chin.y + height * 0.14, rx: height * 0.24, ry: height * 0.18 },
        { cx: middle + height * 0.58, cy: chin.y + height * 0.14, rx: height * 0.24, ry: height * 0.18 },
      ],
    },
    face: {
      nose: { cx: nose.x, cy: nose.y, rx: distance * 0.28, ry: distance * 0.28 },
      mouth: { cx: mouth.x, cy: mouth.y + distance * 0.05, rx: distance * 0.45, ry: distance * 0.27 },
      eyeA: { cx: left.cx, cy: left.cy, rx: distance * 0.4, ry: distance * 0.26 },
      eyeB: { cx: right.cx, cy: right.cy, rx: distance * 0.4, ry: distance * 0.26 },
      earL: { cx: middle - distance * 1.3, cy: eyeLine + distance * 0.25, rx: distance * 0.2, ry: distance * 0.31 },
      earR: { cx: middle + distance * 1.3, cy: eyeLine + distance * 0.25, rx: distance * 0.2, ry: distance * 0.31 },
      brow: { cx: middle, cy: eyeLine - distance * 0.25, rx: distance * 0.92, ry: distance * 0.18, band: [eyeLine - distance * 0.2, eyeLine - distance * 0.02] },
      jaw: { cx: mouth.x, cy: chin.y - distance * 0.12, rx: distance * 0.57, ry: distance * 0.22, band: [chin.y - distance * 0.28, chin.y - distance * 0.01] },
    },
    eyes: [eyeOf(left), eyeOf(right)],
    mouth: {
      cx: mouth.x,
      cy: mouth.y,
      angle: tilt,
      halfLen: distance * 0.34,
      bow: distance * 0.04,
      area: { cx: mouth.x, cy: mouth.y + distance * 0.07, rx: distance * 0.45, ry: distance * 0.24, angle: tilt },
    },
    cheeks: [[left.cx - distance * 0.2, left.cy + distance * 0.39], [right.cx + distance * 0.2, right.cy + distance * 0.39]],
    mesh: {
      baseCell: 14,
      fine: { x0: clampX(middle - height), x1: clampX(middle + height), y0: clampY(marks.top.y), y1: clampY(chin.y + height * 0.5), cell: 7 },
      handCell: 9,
      tasselCell: 6,
      eyeBallCell: 4,
      eyeCell: 3,
      spriteCell: 4,
    },
    view: { padTop: 0, padSide: 0, gazeCenter: [middle, eyeLine] },
  }
}

/**
 * The eye around a click: the dark shape (lashes and iris) connected to it, measured against the brightness of the skin
 * around it. Hair that touches the search window would run away with the shape, so the shape is held to eye proportions.
 */
export function findEye({ luma, width, height }: Gray, click: Point, eyeDistance: number): Ellipse {
  const fallback = { cx: click.x, cy: click.y, rx: eyeDistance * 0.24, ry: eyeDistance * 0.13 }
  const reachX = Math.round(eyeDistance * 0.38)
  const reachY = Math.round(eyeDistance * 0.22)
  const x0 = Math.max(0, Math.round(click.x) - reachX)
  const x1 = Math.min(width - 1, Math.round(click.x) + reachX)
  const y0 = Math.max(0, Math.round(click.y) - reachY)
  const y1 = Math.min(height - 1, Math.round(click.y) + reachY)
  const seen: number[] = []
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++)
      seen.push(luma[y * width + x]!)
  }
  if (!seen.length)
    return fallback
  seen.sort((a, b) => a - b)
  const dark = seen[Math.floor(seen.length * 0.05)]!
  const skin = seen[Math.floor(seen.length * 0.75)]!
  if (skin - dark < 40)
    return fallback
  const threshold = dark + (skin - dark) * 0.45
  // Grow from the dark pixel nearest the click, staying inside the window.
  let start = -1
  let best = Infinity
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const away = (x - click.x) ** 2 + (y - click.y) ** 2
      if (luma[y * width + x]! < threshold && away < best) {
        best = away
        start = y * width + x
      }
    }
  }
  if (start < 0)
    return fallback
  const visited = new Set([start])
  const stack = [start]
  let [left, right, top, bottom] = [Infinity, -Infinity, Infinity, -Infinity]
  while (stack.length) {
    const at = stack.pop()!
    const x = at % width
    const y = (at - x) / width
    left = Math.min(left, x)
    right = Math.max(right, x)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      const next = ny * width + nx
      if (nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1 && !visited.has(next) && luma[next]! < threshold) {
        visited.add(next)
        stack.push(next)
      }
    }
  }
  const rx = Math.max(eyeDistance * 0.14, Math.min(eyeDistance * 0.38, (right - left + 1) / 2))
  const ry = Math.max(eyeDistance * 0.07, Math.min(eyeDistance * 0.22, (bottom - top + 1) / 2))
  // A shape as wide as the whole window hit something other than the eye: its centre says nothing, trust the click.
  const clipped = left <= x0 || right >= x1 || top <= y0 || bottom >= y1
  return clipped ? { cx: click.x, cy: click.y, rx: Math.min(rx, fallback.rx * 1.2), ry: Math.min(ry, fallback.ry * 1.2) } : { cx: (left + right + 1) / 2, cy: (top + bottom + 1) / 2, rx, ry }
}

const tolerance = 26

/**
 * Makes a plain background transparent: pixels close to the border's colour and connected to the border, so white
 * inside a figure stays. Returns false, changing nothing, if the picture is already cut out or its background is busy.
 */
export function clearPlainBackground(data: Uint8ClampedArray, width: number, height: number) {
  const border: number[] = []
  for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x)
  for (let y = 1; y < height - 1; y++) border.push(y * width, y * width + width - 1)
  if (border.some(at => data[at * 4 + 3]! < 250))
    return false
  const channel = (offset: number) => border.map(at => data[at * 4 + offset]!).sort((a, b) => a - b)[border.length >> 1]!
  const [r, g, b] = [channel(0), channel(1), channel(2)]
  const close = (at: number) => Math.max(Math.abs(data[at * 4]! - r), Math.abs(data[at * 4 + 1]! - g), Math.abs(data[at * 4 + 2]! - b)) <= tolerance
  if (border.filter(close).length < border.length * 0.7)
    return false
  const visited = new Uint8Array(width * height)
  const stack = border.filter(close)
  for (const at of stack) visited[at] = 1
  while (stack.length) {
    const at = stack.pop()!
    data[at * 4 + 3] = 0
    const x = at % width
    for (const next of [x > 0 ? at - 1 : -1, x < width - 1 ? at + 1 : -1, at - width, at + width]) {
      if (next >= 0 && next < width * height && !visited[next] && close(next)) {
        visited[next] = 1
        stack.push(next)
      }
    }
  }
  return true
}

/** Where to frame her: what is drawn, and the bottom of it for the hand she holds things in. */
export function frameFromAlpha(data: Uint8ClampedArray, width: number, height: number): { crop: Box, hands: Ellipse } {
  let [x0, y0, x1, y1] = [width, height, 0, 0]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! >= 16) {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x + 1)
        y1 = Math.max(y1, y + 1)
      }
    }
  }
  const crop = x1 > x0 ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: width, y1: height }
  const w = crop.x1 - crop.x0
  const h = crop.y1 - crop.y0
  return { crop, hands: { cx: (crop.x0 + crop.x1) / 2, cy: crop.y1 - h * 0.06, rx: w * 0.14, ry: h * 0.05 } }
}
