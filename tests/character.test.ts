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

describe('companions', () => {
  it('has three women and three men, each with a card, a voice and a working model path', async () => {
    const { characters } = await import('../packages/character/manifest')
    expect(characters.filter(item => item.gender === 'female')).toHaveLength(3)
    expect(characters.filter(item => item.gender === 'male')).toHaveLength(3)
    expect(new Set(characters.map(item => item.name)).size).toBe(characters.length)
    for (const item of characters) {
      expect(item.persona).toContain(item.name.replace(/（.*/, ''))
      expect(item.modelPath).toMatch(/^\.\/characters\/[a-z]+\/.+\.model3\.json$/)
    }
  })
  it('falls back to Anna for unknown or missing ids', async () => {
    const { companion } = await import('../packages/character/manifest')
    expect(companion('natori').name).toBe('名执尽')
    expect(companion('ren').name).toBe('Anna')
    expect(companion(undefined).id).toBe('hiyori')
  })
  it('maps standard parameter names onto Cubism 2-era and renamed parameters', async () => {
    const { companion, paramId } = await import('../packages/character/manifest')
    const chitose = companion('chitose')
    expect(paramId(chitose, 'ParamEyeLOpen')).toBe('PARAM_EYE_L_OPEN')
    expect(paramId(chitose, 'ParamBodyAngleX')).toBe('PARAM_BODY_ANGLE_X')
    expect(paramId(chitose, 'ParamBrowLForm')).toBe('PARAM_BROW_L_FORM')
    expect(paramId(chitose, 'ParamBrowLY')).toBe('PARAM_BROW_L_Y')
    expect(paramId(chitose, 'ParamEyeBallX')).toBe('PARAM_EYE_BALL_X')
    expect(paramId(companion('mao'), 'ParamMouthOpenY')).toBe('ParamA')
    expect(paramId(companion('hiyori'), 'ParamMouthOpenY')).toBe('ParamMouthOpenY')
  })
})
