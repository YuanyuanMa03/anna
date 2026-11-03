import { afterEach, describe, expect, it, vi } from 'vitest'
import { modelSpeech } from '../apps/desktop/src/model-speech'

class SilentAudio {
  static instances: SilentAudio[] = []
  onplaying?: () => void
  onended?: () => void
  onerror?: () => void
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
  return { player: modelSpeech(invoke, speaking), speaking, invoke, revoke }
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
})
