import { readFileSync } from 'node:fs'
import { unpackAvatar, validateAvatarFiles } from 'mesh-avatar'
import { describe, expect, it } from 'vitest'
import { characters, companion, fitStage } from '../packages/character/manifest'

describe('model containment', () => {
  it.each([[500, 350, 2100, 3300, 0.86], [340, 260, 1000, 1000, 0.9], [700, 800, 500, 2800, 0.9]])('keeps the full model inside the stage', (w, h, mw, mh, factor) => {
    const fit = fitStage(w, h, mw, mh, factor)
    expect(fit.x - mw * fit.scale / 2).toBeGreaterThanOrEqual(0)
    expect(fit.y - mh * fit.scale / 2).toBeGreaterThanOrEqual(0)
    expect(fit.x + mw * fit.scale / 2).toBeLessThanOrEqual(w)
    expect(fit.y + mh * fit.scale / 2).toBeLessThanOrEqual(h)
  })
})

describe('the cast', () => {
  it('is Anna alone, with a card, a voice and both her forms', () => {
    expect(characters.map(item => item.name)).toEqual(['Anna'])
    const [anna] = characters
    expect(anna.persona).toContain('Anna')
    expect(anna.modelPath).toMatch(/^\.\/characters\/haru\/.+\.model3\.json$/)
    expect(anna.body.path).toBe('./anna-body/anna.mavatar')
  })
  it('falls back to Anna for anyone who has left or was never here', () => {
    for (const id of ['hiyori', 'mark', 'mao', 'natori', 'chitose', 'ren', undefined])
      expect(companion(id).name).toBe('Anna')
  })
  it('ships her body in the repository, as a complete archive', () => {
    const files = unpackAvatar(readFileSync(new URL('../assets/anna-body/anna.mavatar', import.meta.url)))
    expect(validateAvatarFiles(files)).toEqual([])
  })
})
