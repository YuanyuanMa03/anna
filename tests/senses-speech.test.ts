import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { speechSegments, SpeechSession } from '../packages/senses/speech'

describe('model speech output', () => {
  it('retains long Chinese replies and omits code blocks from speech', () => {
    const text = '这是结果。'.repeat(180)
    expect(speechSegments(text).join('')).toBe(text)
    expect(speechSegments('完成。```sh\nrm example\n```请检查。')).toEqual(['完成。', '请检查。'])
  })

  it('does not play a late synthesis result after stop', async () => {
    let resolve!: (value: Blob) => void
    const play = vi.fn()
    const session = new SpeechSession({ synthesize: () => new Promise(r => resolve = r), play, stop: vi.fn() })
    const pending = session.speak('你好。下一句。')
    session.stop()
    resolve(new Blob(['audio']))
    await pending
    expect(play).not.toHaveBeenCalled()
  })

  it('cancels the previous turn without canceling its replacement', async () => {
    let resolve!: (value: Blob) => void
    const play = vi.fn(async (_audio: Blob, _signal: AbortSignal) => {})
    const synthesize = vi.fn().mockImplementationOnce(() => new Promise(r => resolve = r)).mockResolvedValue(new Blob(['new']))
    const session = new SpeechSession({ synthesize, play, stop: vi.fn() })
    const old = session.speak('旧回复。')
    await session.speak('新回复。')
    resolve(new Blob(['old']))
    await old
    expect(play).toHaveBeenCalledTimes(1)
    expect(await play.mock.calls[0]![0].text()).toBe('new')
  })

  it('reports provider failure without falling back to system speech', async () => {
    const play = vi.fn()
    const session = new SpeechSession({ synthesize: async () => { throw new Error('服务不可用') }, play, stop: vi.fn() })
    await expect(session.speak('你好。')).rejects.toThrow('服务不可用')
    expect(play).not.toHaveBeenCalled()
    const app = readFileSync(new URL('../apps/desktop/src/app.vue', import.meta.url), 'utf8')
    expect(app).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance/)
  })
})
