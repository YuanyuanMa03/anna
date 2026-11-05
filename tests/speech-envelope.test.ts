import { describe, expect, it } from 'vitest'
import { speechEnvelope } from '../apps/desktop/src/speech-envelope'

describe('generated speech loudness (synthetic PCM, no devices)', () => {
  it('keeps silence and background noise closed and follows speech strength', () => {
    const pcm = new Float32Array(80)
    pcm.fill(0.004, 20, 40)
    pcm.fill(0.05, 40, 60)
    pcm.fill(0.3, 60)
    const levels = speechEnvelope([pcm], 1000)
    expect(Array.from(levels.slice(0, 2))).toEqual([0, 0])
    expect(levels[2]).toBeGreaterThan(0)
    expect(levels[3]).toBeGreaterThan(levels[2]!)
    expect(levels[3]).toBeLessThanOrEqual(1)
  })
  it('measures stereo power without cancelling opposite-phase channels', () => {
    const left = new Float32Array(40).fill(0.1)
    const right = new Float32Array(40).fill(-0.1)
    expect(speechEnvelope([left, right], 1000)).toEqual(speechEnvelope([left], 1000))
  })
})
