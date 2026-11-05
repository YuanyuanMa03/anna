import { afterEach, describe, expect, it, vi } from 'vitest'
import { modelSpeech } from '../apps/desktop/src/model-speech'

class SilentAudio {
  static instances: SilentAudio[] = []
  onplaying?: () => void
  onended?: () => void
  onerror?: () => void
  onwaiting?: () => void
  onpause?: () => void
  currentTime = 0
  pause = vi.fn()
  removeAttribute = vi.fn()
  play = vi.fn(async () => { this.onplaying?.() })
  constructor() { SilentAudio.instances.push(this) }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); SilentAudio.instances = [] })
function setup() {
  vi.stubGlobal('Audio', SilentAudio)
  const speaking = vi.fn()
  const invoke = vi.fn(async () => ({ ok: true as const, audio: { base64: 'AQID', mime: 'audio/wav' } }))
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  const level = vi.fn()
  return { player: modelSpeech(invoke, speaking, level), speaking, level, invoke, revoke }
}
describe('model-generated speech playback without speakers', () => {
  it('does nothing on construction and drives speaking from actual playback events', async () => {
    const { player, invoke, speaking, revoke } = setup()
    expect(invoke).not.toHaveBeenCalled()
    expect(SilentAudio.instances).toHaveLength(0)
    const result = player.speak('你好。')
    await vi.waitFor(() => expect(speaking).toHaveBeenLastCalledWith(true))
    SilentAudio.instances[0]!.onended?.()
    await result
    expect(speaking).toHaveBeenLastCalledWith(false)
    expect(revoke).toHaveBeenCalledTimes(1)
  })
  it('stops playback and never starts the remaining sentences', async () => {
    const { player, invoke, speaking } = setup()
    const pending = player.speak('第一句。第二句。')
    await vi.waitFor(() => expect(speaking).toHaveBeenLastCalledWith(true))
    const audio = SilentAudio.instances[0]!
    player.stop()
    await pending
    expect(audio.pause).toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledTimes(1)
    audio.onplaying?.()
    expect(speaking).toHaveBeenLastCalledWith(false)
  })
  it('reports playback failure and releases audio instead of using system speech', async () => {
    const { player, speaking, revoke } = setup()
    const pending = player.speak('你好。')
    const rejection = expect(pending).rejects.toThrow('模型语音无法播放')
    await vi.waitFor(() => expect(SilentAudio.instances).toHaveLength(1))
    SilentAudio.instances[0]!.onerror?.()
    await rejection
    expect(speaking).toHaveBeenLastCalledWith(false)
    expect(revoke).toHaveBeenCalledTimes(1)
  })
  it('uses the playback clock and real waveform, closes during buffering, and drops late frames', async () => {
    // Synthetic PCM: 20 ms silence, 20 ms tone, then silence. No audio device is used.
    const pcm = new Float32Array(60)
    pcm.fill(0.12, 20, 40)
    vi.stubGlobal('OfflineAudioContext', class {
      decodeAudioData = vi.fn(async () => ({ sampleRate: 1000, numberOfChannels: 1, getChannelData: () => pcm }))
    })
    let frame: FrameRequestCallback | undefined
    const requestFrame = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1 })
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const { player, level, speaking } = setup()
    const pending = player.speak('你好。')
    await vi.waitFor(() => expect(speaking).toHaveBeenLastCalledWith(true))
    const audio = SilentAudio.instances[0]!
    expect(level).toHaveBeenLastCalledWith(0)
    audio.currentTime = 0.025
    frame!(0)
    expect(level.mock.lastCall![0]).toBeGreaterThan(0.3)
    audio.onwaiting?.()
    expect(level).toHaveBeenLastCalledWith(0)
    expect(speaking).toHaveBeenLastCalledWith(false)
    const stale = frame!
    stale(0)
    expect(level).toHaveBeenLastCalledWith(0)
    audio.onplaying?.()
    expect(level.mock.lastCall![0]).toBeGreaterThan(0.3)
    const requests = requestFrame.mock.calls.length
    stale(0)
    expect(requestFrame).toHaveBeenCalledTimes(requests)
    audio.currentTime = 0.045
    frame!(0)
    expect(level).toHaveBeenLastCalledWith(0)
    player.stop()
    await pending
    stale(0)
    audio.onplaying?.()
    expect(level).toHaveBeenLastCalledWith(0)
    expect(speaking).toHaveBeenLastCalledWith(false)
    expect(cancel).toHaveBeenCalled()
  })
  it('keeps original playback usable when loudness decoding fails', async () => {
    vi.stubGlobal('OfflineAudioContext', class {
      decodeAudioData = vi.fn(async () => { throw new Error('unsupported analysis codec') })
    })
    const { player, level, speaking } = setup()
    const pending = player.speak('你好。')
    await vi.waitFor(() => expect(speaking).toHaveBeenLastCalledWith(true))
    expect(level.mock.calls.every(([value]) => value === 0)).toBe(true)
    SilentAudio.instances[0]!.onended?.()
    await pending
  })
  it('does not start audio after cancellation during waveform decoding', async () => {
    let decoded: (value: unknown) => void = () => {}
    const decode = vi.fn(() => new Promise((resolve) => { decoded = resolve }))
    vi.stubGlobal('OfflineAudioContext', class { decodeAudioData = decode })
    const { player, speaking } = setup()
    const pending = player.speak('你好。')
    await vi.waitFor(() => expect(decode).toHaveBeenCalled())
    player.stop()
    decoded({ sampleRate: 1000, numberOfChannels: 1, getChannelData: () => new Float32Array(20) })
    await pending
    expect(SilentAudio.instances).toHaveLength(0)
    expect(speaking).not.toHaveBeenCalledWith(true)
  })
})
