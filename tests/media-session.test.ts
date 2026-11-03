import { describe, expect, it, vi } from 'vitest'
import { MediaSession } from '../apps/desktop/src/media-session'

function stream() {
  const track = { stop: vi.fn(), addEventListener: vi.fn() }
  return { track, value: { getTracks: () => [track] } as unknown as MediaStream }
}
describe('explicit device capture', () => {
  it('captures the selected display without requesting system audio or camera', async () => {
    const input = stream()
    const getDisplayMedia = vi.fn().mockResolvedValue(input.value)
    const getUserMedia = vi.fn()
    const session = new MediaSession({ getUserMedia, getDisplayMedia })
    await session.open('screen')
    expect(getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: false })
    expect(getUserMedia).not.toHaveBeenCalled()
    session.stop()
    expect(input.track.stop).toHaveBeenCalledOnce()
  })
  it('never requests media on construction and releases a late grant after cancellation', async () => {
    const input = stream()
    let grant!: (value: MediaStream) => void
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => grant = resolve))
    const session = new MediaSession({ getUserMedia })
    expect(getUserMedia).not.toHaveBeenCalled()
    const pending = session.open('camera')
    session.stop()
    grant(input.value)
    await expect(pending).rejects.toThrow('取消')
    expect(input.track.stop).toHaveBeenCalledOnce()
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }))
  })
  it('changing devices stops the previous stream and hardware loss ends the active session', async () => {
    const first = stream()
    const second = stream()
    const ended = vi.fn()
    const getUserMedia = vi.fn().mockResolvedValueOnce(first.value).mockResolvedValueOnce(second.value)
    const session = new MediaSession({ getUserMedia }, ended)
    await session.open('microphone')
    await session.open('camera')
    expect(first.track.stop).toHaveBeenCalledOnce()
    first.track.addEventListener.mock.calls[0]![1]()
    expect(ended).not.toHaveBeenCalled()
    second.track.addEventListener.mock.calls[0]![1]()
    expect(ended).toHaveBeenCalledOnce()
    expect(second.track.stop).toHaveBeenCalledOnce()
  })
  it('propagates denied permission without trying another device', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('denied'))
    await expect(new MediaSession({ getUserMedia }).open('microphone')).rejects.toThrow('denied')
    expect(getUserMedia).toHaveBeenCalledOnce()
  })
})
