import type { FaceMarks } from '../../../packages/character/make-avatar'
import type { Box, Ellipse } from '../../../packages/character/manifest'
import { openAvatar, packAvatar } from 'mesh-avatar'
import { clearPlainBackground, findEye, frameFromAlpha, maxSide, rigFromMarks } from '../../../packages/character/make-avatar'

/** The person's own Anna: kept with this machine's other stage preferences, in the window's own storage. */
export interface MyAvatar { archive: Blob, crop: Box, hands: Ellipse }
/** A picture ready to be marked: scaled down, its plain background cleared. */
export interface Picture { data: ImageData, url: string, width: number, height: number, cleared: boolean }

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('anna', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('avatars')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function store<T>(mode: IDBTransactionMode, work: (avatars: IDBObjectStore) => IDBRequest<T>) {
  const db = await database()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction('avatars', mode).objectStore('avatars'))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  finally { db.close() }
}
export const readMyAvatar = () => store<MyAvatar | undefined>('readonly', avatars => avatars.get('mine'))
export const saveMyAvatar = (avatar: MyAvatar) => store('readwrite', avatars => avatars.put(avatar, 'mine'))
export const forgetMyAvatar = () => store('readwrite', avatars => avatars.delete('mine'))

function canvas(width: number, height: number) {
  const surface = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
  return { surface, context: surface.getContext('2d', { willReadFrequently: true })! }
}
const png = async (surface: OffscreenCanvas) => new Uint8Array(await (await surface.convertToBlob({ type: 'image/png' })).arrayBuffer())

export async function openPicture(file: Blob): Promise<Picture> {
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('这个文件打不开，请换一张 PNG、JPG 或 WebP 图片。') })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const { surface, context } = canvas(width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const data = context.getImageData(0, 0, width, height)
  const cleared = clearPlainBackground(data.data, width, height)
  context.putImageData(data, 0, 0)
  return { data, url: URL.createObjectURL(await surface.convertToBlob({ type: 'image/png' })), width, height, cleared }
}

/** A colour from the picture inside a box: the median for skin, a dark percentile for lashes. */
function sample({ data, width, height }: ImageData, box: Box, percentile: number) {
  const seen: [number, number, number, number][] = []
  for (let y = Math.max(0, Math.round(box.y0)); y < Math.min(height, box.y1); y++) {
    for (let x = Math.max(0, Math.round(box.x0)); x < Math.min(width, box.x1); x++) {
      const at = (y * width + x) * 4
      if (data[at + 3]! > 200)
        seen.push([data[at]! * 0.299 + data[at + 1]! * 0.587 + data[at + 2]! * 0.114, data[at]!, data[at + 1]!, data[at + 2]!])
    }
  }
  if (!seen.length)
    return '#d8b8a8'
  seen.sort((a, b) => a[0] - b[0])
  const [, r, g, b] = seen[Math.floor((seen.length - 1) * percentile)]!
  return `rgb(${r} ${g} ${b})`
}

/** What a single picture does not hold: her eye half or fully closed, painted over the eye in the picture's own colours. */
async function eyeDrawing(picture: Picture, eye: Ellipse, closed: boolean) {
  const { cx, cy, rx, ry } = eye
  const x = Math.max(0, Math.floor(cx - rx * 1.7))
  const y = Math.max(0, Math.floor(cy - ry * 2.2))
  const width = Math.min(picture.width - x, Math.ceil(rx * 3.4))
  const height = Math.min(picture.height - y, Math.ceil(ry * 4.4))
  const skin = sample(picture.data, { x0: cx - rx * 0.6, x1: cx + rx * 0.6, y0: cy + ry * 1.5, y1: cy + ry * 2.4 }, 0.5)
  const ink = sample(picture.data, { x0: cx - rx, x1: cx + rx, y0: cy - ry, y1: cy + ry }, 0.06)
  const { surface, context } = canvas(width, height)
  context.translate(-x, -y)
  if (!closed) {
    context.beginPath()
    context.rect(x, y, width, cy + ry * 0.1 - y)
    context.clip()
  }
  context.filter = `blur(${Math.max(1, ry * 0.16)}px)`
  context.fillStyle = skin
  context.beginPath()
  context.ellipse(cx, cy, rx * 1.2, ry * 1.32, 0, 0, Math.PI * 2)
  context.fill()
  context.filter = 'none'
  context.strokeStyle = ink
  context.lineCap = 'round'
  context.lineWidth = Math.max(1.5, ry * 0.2)
  context.beginPath()
  context.moveTo(cx - rx * 1.02, cy - ry * 0.05)
  context.quadraticCurveTo(cx, cy + ry * (closed ? 0.85 : 0.2), cx + rx * 1.02, cy - ry * 0.05)
  context.stroke()
  return { rect: [x, y, width, height] as [number, number, number, number], file: await png(surface) }
}

/** Just the eye's white and iris, moved by the gaze; the rest of the eye stays painted in the base. */
async function eyeBall(picture: Picture, { cx, cy, rx, ry }: Ellipse) {
  const x = Math.max(0, Math.floor(cx - rx))
  const y = Math.max(0, Math.floor(cy - ry))
  const width = Math.min(picture.width - x, Math.ceil(rx * 2))
  const height = Math.min(picture.height - y, Math.ceil(ry * 2))
  const whole = canvas(picture.width, picture.height)
  whole.context.putImageData(picture.data, 0, 0)
  const { surface, context } = canvas(width, height)
  context.beginPath()
  context.ellipse(cx - x, cy - y, rx, ry, 0, 0, Math.PI * 2)
  context.clip()
  context.drawImage(whole.surface, -x, -y)
  return { rect: [x, y, width, height] as [number, number, number, number], file: await png(surface) }
}

/** The whole avatar from a marked picture, proved by the runtime that will have to open it. */
export async function makeAvatar(picture: Picture, marks: FaceMarks): Promise<MyAvatar> {
  const { width, height, data } = picture
  const luma = new Uint8ClampedArray(width * height)
  for (let at = 0; at < luma.length; at++)
    luma[at] = data.data[at * 4 + 3]! < 32 ? 255 : data.data[at * 4]! * 0.299 + data.data[at * 4 + 1]! * 0.587 + data.data[at * 4 + 2]! * 0.114
  const distance = Math.hypot(marks.eyeB.x - marks.eyeA.x, marks.eyeB.y - marks.eyeA.y)
  const gray = { luma, width, height }
  const found = [findEye(gray, marks.eyeA, distance), findEye(gray, marks.eyeB, distance)] as const
  const rig = rigFromMarks(picture, marks, found)
  const eyes = marks.eyeA.x <= marks.eyeB.x ? found : [found[1], found[0]] as const

  const base = canvas(width, height)
  base.context.putImageData(data, 0, 0)
  // No hair is marked, so none of it sways; the mask stays empty.
  const hair = canvas(width, height)
  hair.context.fillRect(0, 0, width, height)
  // The runtime needs the eye's line layers; here the lines stay painted in the base, so these draw nothing.
  const nothing = await png(canvas(2, 2).surface)
  const files: Record<string, Uint8Array> = { 'built/base.png': await png(base.surface), 'built/hairmask.png': await png(hair.surface) }
  const layers: Record<string, [number, number, number, number]> = {}
  const sprites: Record<string, [number, number, number, number]> = {}
  for (const [index, eye] of eyes.entries()) {
    const ball = await eyeBall(picture, eye)
    layers[`eye${index}_ball`] = ball.rect
    files[`built/eye${index}_ball.png`] = ball.file
    for (const part of ['low', 'crease', 'lash']) {
      layers[`eye${index}_${part}`] = [ball.rect[0], ball.rect[1], 2, 2]
      files[`built/eye${index}_${part}.png`] = nothing
    }
    for (const [name, closed] of [['eyes_closed', true], ['eyes_half', false]] as const) {
      const drawing = await eyeDrawing(picture, eye, closed)
      sprites[`${name}_${index}`] = drawing.rect
      files[`built/sprites/${name}_${index}.png`] = drawing.file
    }
  }
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
  const build = crypto.randomUUID().slice(0, 12)
  files['rig.json'] = encode(rig)
  files['built/layers.json'] = encode({ version: 1, size: [width, height], build, layers, eyes: rig.eyes.map(({ x0, x1, top, bot }) => ({ x0, x1, top, bot })) })
  files['built/sprites/sprites.json'] = encode({ version: 1, build, layers: sprites })
  const archive = packAvatar(files, { manifest: { name: 'my-anna' } })
  const opened = await openAvatar(archive)
  opened.release()
  return { archive: new Blob([new Uint8Array(archive)], { type: 'application/zip' }), ...frameFromAlpha(data.data, width, height) }
}

/** A finished `.mavatar` the person already has, from Studio or from a task Anna ran: checked, then framed by what it draws. */
export async function avatarFromArchive(file: Blob): Promise<MyAvatar> {
  const opened = await openAvatar(await file.arrayBuffer()).catch((cause: Error) => { throw new Error(`这个 .mavatar 文件打不开：${cause.message.split('\n')[0]}`) })
  try {
    const bitmap = await createImageBitmap(await (await fetch(opened.assets['base.png']!)).blob())
    const { context } = canvas(bitmap.width, bitmap.height)
    context.drawImage(bitmap, 0, 0)
    const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height)
    bitmap.close()
    return { archive: file, ...frameFromAlpha(data, width, height) }
  }
  finally { opened.release() }
}
