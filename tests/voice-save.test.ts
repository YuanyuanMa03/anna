import type { VoiceConfig, VoiceReply, VoiceRequest } from '../packages/voice/contracts'
import { describe, expect, it, vi } from 'vitest'
import { saveVoice } from '../apps/desktop/src/voice-save'
import { speechDefaults } from '../packages/voice/presets'

const tts: VoiceConfig = { mode: 'cloud', ...speechDefaults('cloud', true) }
const asr = { mode: 'cloud' as const, ...speechDefaults('cloud', false) }
function saved(request: VoiceRequest): VoiceReply {
  return request.type === 'voice-configure'
    ? { ok: true, config: request.config, hasKey: true, recognitionHasKey: false }
    : { ok: true, config: tts, recognition: (request as Extract<VoiceRequest, { type: 'recognition-configure' }>).config, hasKey: true, recognitionHasKey: true }
}

describe('saving voice settings', () => {
  it('saves the untouched other direction with its preset, without a key of its own', async () => {
    const invoke = vi.fn(async (request: VoiceRequest) => saved(request))
    const outcome = await saveVoice(invoke, 'synthesis', tts, 'secret', { saved: false, dirty: false }, () => true)
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[1]![0]).toMatchObject({ type: 'recognition-configure', config: { protocol: 'chat', model: 'mimo-v2.5-asr' } })
    expect(invoke.mock.calls[1]![0]).not.toHaveProperty('key')
    expect(outcome).toMatchObject({ both: true, message: '语音识别与合成配置已保存。', reply: { recognitionHasKey: true } })
  })

  it.each([
    ['already set up', { saved: true, dirty: false }],
    ['being edited', { saved: false, dirty: true }],
  ])('leaves the other direction alone when it is %s', async (_name, other) => {
    const invoke = vi.fn(async (request: VoiceRequest) => saved(request))
    const outcome = await saveVoice(invoke, 'synthesis', tts, 'secret', other, () => true)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(outcome).toMatchObject({ both: false, message: '语音合成配置已保存。' })
  })

  it('does not follow another address, another protocol, or a closed sheet', async () => {
    for (const [config, open] of [[{ ...tts, baseURL: 'https://api.xiaomimimo.com/v1' }, true], [{ ...tts, protocol: 'audio' }, true], [tts, false]] as const) {
      const invoke = vi.fn(async (request: VoiceRequest) => saved(request))
      await saveVoice(invoke, 'synthesis', config as VoiceConfig, 'secret', { saved: false, dirty: false }, () => open)
      expect(invoke).toHaveBeenCalledTimes(1)
    }
  })

  it('says the first side was saved when only the second fails', async () => {
    const refusing = vi.fn(async (request: VoiceRequest) => request.type === 'voice-configure' ? saved(request) : { ok: false as const, error: '服务拒绝' })
    expect(await saveVoice(refusing, 'synthesis', tts, 'secret', { saved: false, dirty: false }, () => true)).toMatchObject({ both: false, message: '语音合成配置已保存；语音识别未能一起保存：服务拒绝' })
    const throwing = vi.fn(async (request: VoiceRequest) => {
      if (request.type === 'voice-configure')
        return saved(request); throw new Error('ipc')
    })
    expect(await saveVoice(throwing, 'synthesis', tts, 'secret', { saved: false, dirty: false }, () => true)).toMatchObject({ both: false, message: '语音合成配置已保存；语音识别未能一起保存，请稍后在下方单独保存。' })
  })

  it('reports a refused first save as it is', async () => {
    const invoke = vi.fn(async () => ({ ok: false as const, error: '地址不对' }))
    expect(await saveVoice(invoke, 'recognition', asr, undefined, { saved: false, dirty: false }, () => true)).toEqual({ message: '地址不对' })
  })
})
