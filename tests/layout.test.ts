import { describe, expect, it } from 'vitest'
import { captionPlace } from '../packages/character/layout'

const viewport = { width: 1280, height: 800 }
const size = { width: 360, height: 200 }

describe('caption place', () => {
  it('puts her words beside her face, on the side away from her hand', () => {
    const place = captionPlace({ mouth: { x: 640, y: 330 }, viewport, size })
    expect(place.side).toBe('left')
    expect(place.left + size.width).toBeLessThan(640)
    expect(place.left + size.width).toBeGreaterThan(640 - 200)
    expect(place.top).toBeLessThan(330)
    expect(place.top + size.height).toBeGreaterThan(330)
  })
  it('keeps clear of her hair when her head is drawn wide', () => {
    const place = captionPlace({ mouth: { x: 980, y: 330 }, clearance: 420, viewport: { width: 2000, height: 1200 }, size })
    expect(place.side).toBe('left')
    expect(place.left + size.width).toBeLessThanOrEqual(980 - 420)
  })
  it('narrows her words to stay on her left before giving up that side', () => {
    const place = captionPlace({ mouth: { x: 640, y: 330 }, clearance: 300, viewport, size })
    expect(place.side).toBe('left')
    expect(place.width).toBeLessThan(size.width)
    expect(place.width).toBeGreaterThanOrEqual(220)
    expect(place.left).toBeGreaterThanOrEqual(16)
    expect(place.left + place.width).toBeLessThanOrEqual(640 - 300)
  })
  it('moves to her other side when there is no room on the left', () => {
    const place = captionPlace({ mouth: { x: 300, y: 330 }, viewport, size })
    expect(place.side).toBe('right')
    expect(place.left).toBeGreaterThan(300)
  })
  it('falls back to the left edge, away from the cards, when neither side has room', () => {
    const place = captionPlace({ mouth: { x: 450, y: 330 }, clearance: 360, viewport: { width: 900, height: 700 }, size })
    expect(place.side).toBe('left')
    expect(place.left).toBe(16)
    expect(place.width).toBe(220)
  })
  it('stays inside the window, below the corner bar and above the whisper line', () => {
    const high = captionPlace({ mouth: { x: 640, y: 20 }, viewport, size })
    expect(high.top).toBeGreaterThanOrEqual(64)
    const low = captionPlace({ mouth: { x: 640, y: 790 }, viewport, size })
    expect(low.top + size.height).toBeLessThanOrEqual(viewport.height - 120)
  })
  it('has a resting place before her mouth is known', () => {
    const place = captionPlace({ viewport, size })
    expect(place.left).toBeGreaterThan(0)
    expect(place.top).toBeGreaterThanOrEqual(64)
  })
})
