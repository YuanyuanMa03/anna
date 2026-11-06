import { describe, expect, it } from 'vitest'
import { pcmWav } from '../apps/desktop/src/voice-audio'

describe('synthetic recording conversion, without audio devices', () => {
  it('produces bounded PCM16 mono WAV and clips finite samples', () => {
    const bytes = pcmWav([new Float32Array([0, 1, -1, Number.NaN])], 16000)
    const view = new DataView(bytes.buffer)
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(bytes.length - 8)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(22, true)).toBe(1)
    expect([0, 1, 2, 3].map(i => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 0])
  })
  it('downmixes stereo and resamples before uploading', () => {
    const left = new Float32Array(48000).fill(0.5)
    const right = new Float32Array(48000).fill(-0.25)
    const bytes = pcmWav([left, right], 48000)
    expect(bytes.length).toBe(32044)
    expect(new DataView(bytes.buffer).getInt16(44, true)).toBe(4096)
  })
  it('rejects empty, unequal or overlong recordings', () => {
    expect(() => pcmWav([], 16000)).toThrow()
    expect(() => pcmWav([new Float32Array(2), new Float32Array(3)], 16000)).toThrow()
    expect(() => pcmWav([new Float32Array(16000 * 120 + 1)], 16000)).toThrow()
  })
})
