import { describe, expect, it } from 'vitest'
import { fitStage } from '../packages/character/manifest'

describe('model containment', () => {
  it.each([[500, 350, 2100, 3300, 0.86], [340, 260, 1000, 1000, 0.9], [700, 800, 500, 2800, 0.9]])('keeps the full model inside the stage', (w, h, mw, mh, factor) => {
    const fit = fitStage(w, h, mw, mh, factor)
    expect(fit.x - mw * fit.scale / 2).toBeGreaterThanOrEqual(0)
    expect(fit.y - mh * fit.scale / 2).toBeGreaterThanOrEqual(0)
    expect(fit.x + mw * fit.scale / 2).toBeLessThanOrEqual(w)
    expect(fit.y + mh * fit.scale / 2).toBeLessThanOrEqual(h)
  })
})
