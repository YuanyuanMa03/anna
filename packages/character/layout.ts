/** Clear space at the top (the corner bar) and bottom (the whisper line and status) her words must not cover. */
const top = 64
const bottom = 120
const margin = 16
/** Narrower than this, a line of her words is too short to read comfortably. */
const narrowest = 220

/**
 * Where her words float: beside her face, on her left (screen left; cards come from the hand on the right). They narrow
 * to stay on that side, move to her right only when even the narrowest column does not fit, and always stay inside the
 * window between the corner bar and the whisper line. `clearance` is how far from her mouth her words must start to stay
 * off her face and hair; `size` is the width they would like and the height they take.
 */
export function captionPlace(input: { mouth?: { x: number, y: number }, clearance?: number, viewport: { width: number, height: number }, size: { width: number, height: number } }) {
  const { mouth, viewport, size } = input
  const gap = input.clearance ?? 120
  const clampTop = (value: number) => Math.min(Math.max(value, top), Math.max(top, viewport.height - bottom - size.height))
  if (!mouth)
    return { left: Math.max(margin, viewport.width * 0.08), top: clampTop(viewport.height * 0.18), width: size.width, side: 'left' as const }
  const y = clampTop(mouth.y - size.height * 0.4)
  const roomLeft = mouth.x - gap - margin
  if (roomLeft >= narrowest) {
    const width = Math.min(size.width, roomLeft)
    return { left: mouth.x - gap - width, top: y, width, side: 'left' as const }
  }
  const width = Math.max(narrowest, Math.min(size.width, viewport.width - margin - mouth.x - gap))
  return { left: Math.min(mouth.x + gap, viewport.width - margin - width), top: y, width, side: 'right' as const }
}
