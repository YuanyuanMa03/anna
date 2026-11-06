import { describe, expect, it } from 'vitest'
import { companionPreset, speechDefaults } from '../packages/voice/presets'
import { validateSpeech, validateSynthesis } from '../packages/voice/service'

describe('voice defaults', () => {
  it('starts on Xiaomi MiMo in the cloud: one address and one key for both directions', () => {
    const synthesis = speechDefaults('cloud', true)
    const recognition = speechDefaults('cloud', false)
    expect(synthesis).toMatchObject({ baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', protocol: 'chat', model: 'mimo-v2.5-tts', voice: '冰糖' })
    expect(recognition).toMatchObject({ baseURL: synthesis.baseURL, protocol: 'chat', model: 'mimo-v2.5-asr' })
    expect(validateSynthesis({ mode: 'cloud', ...synthesis })).toMatchObject({ mode: 'cloud', protocol: 'chat' })
    expect(validateSpeech({ mode: 'cloud', ...recognition })).toMatchObject({ mode: 'cloud', protocol: 'chat' })
  })

  it('fills in the other direction when the cloud preset is saved, so one save and one key are enough', () => {
    const synthesis = { mode: 'cloud' as const, ...speechDefaults('cloud', true) }
    expect(companionPreset(synthesis, false)).toEqual({ mode: 'cloud', ...speechDefaults('cloud', false) })
    expect(companionPreset({ ...speechDefaults('cloud', false), mode: 'cloud' }, true)).toEqual({ mode: 'cloud', ...speechDefaults('cloud', true) })
    expect(companionPreset({ ...synthesis, baseURL: 'https://api.xiaomimimo.com/v1' }, false)).toBeUndefined()
    expect(companionPreset({ mode: 'local', ...speechDefaults('local', true) }, false)).toBeUndefined()
    expect(companionPreset({ ...synthesis, protocol: 'audio' }, false)).toBeUndefined()
  })

  it('keeps the optional local service on this computer, on the audio protocol', () => {
    for (const synthesis of [true, false]) {
      const local = speechDefaults('local', synthesis)
      expect(validateSpeech({ mode: 'local', ...local })).toMatchObject({ baseURL: 'http://127.0.0.1:17861/v1', protocol: 'audio' })
    }
    expect(speechDefaults('local', true).model).toBe('kokoro-local')
    expect(speechDefaults('local', false).model).toBe('paraformer-local')
  })
})
