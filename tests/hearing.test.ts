import { describe, expect, it } from 'vitest'
import { hearingMetadata, mono16k } from '../packages/senses/hearing'

const pack = { remote_package_size: 30, files: [{ filename: '/encoder.onnx', start: 0, end: 10 }, { filename: '/decoder.onnx', start: 10, end: 20 }, { filename: '/tokens.txt', start: 20, end: 30 }] }
describe('local hearing input boundary', () => {
  it('normalizes only the three known model files and rejects damaged ranges', () => {
    expect(hearingMetadata(pack, 30).files[0]!.filename).toBe('encoder.onnx')
    expect(() => hearingMetadata(pack, 29)).toThrow()
    for (const change of [{ filename: '../encoder.onnx' }, { filename: '/tokens.txt' }, { start: 20, end: 31 }, { start: 1.5 }])
      expect(() => hearingMetadata({ ...pack, files: [{ ...pack.files[0], ...change }, ...pack.files.slice(1)] }, 30)).toThrow()
    expect(() => hearingMetadata({ ...pack, files: [pack.files[0], { ...pack.files[1], start: 9 }, pack.files[2]] }, 30)).toThrow('重叠')
  })
  it('mixes stereo to mono, resamples and retains duration', () => {
    const output = mono16k([new Float32Array(48000).fill(1), new Float32Array(48000).fill(-1)], 48000)
    expect(output.length).toBe(16000)
    expect(output.every(value => value === 0)).toBe(true)
    expect(mono16k([new Float32Array([0, 1])], 8000)).toEqual(new Float32Array([0, 0.5, 1, 1]))
  })
  it('bounds duration and sanitizes corrupt samples without playing or uploading them', () => {
    expect(() => mono16k([], 16000)).toThrow()
    expect(() => mono16k([new Float32Array(1)], 0)).toThrow()
    expect(() => mono16k([new Float32Array(16000 * 121)], 16000)).toThrow('两分钟')
    expect(mono16k([new Float32Array([Number.NaN, Infinity, 2])], 16000)).toEqual(new Float32Array([0, 0, 1]))
  })
})
