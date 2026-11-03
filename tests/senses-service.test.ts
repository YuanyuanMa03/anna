import type { VoiceConfig } from '../packages/senses/contracts'
import { describe, expect, it, vi } from 'vitest'
import { SensesService, validateVoice } from '../packages/senses/service'

const config: VoiceConfig = { baseURL: 'https://voice.example/v1', model: 'chinese-tts', voice: 'anna' }
function setup(request: typeof fetch = vi.fn()) {
  let saved = JSON.stringify({ config, key: 'secret-example' })
  const vault = { read: async () => saved, write: async (value: string) => { saved = value } }
  return { service: new SensesService(vault, request), vault, saved: () => saved }
}

describe('host voice service', () => {
  it('keeps stored credentials out of status and requires a new key for endpoint changes', async () => {
    const { service } = setup()
    expect(JSON.stringify(await service.execute({ type: 'voice-status' }))).not.toContain('secret-example')
    const result = await service.execute({ type: 'voice-configure', config: { ...config, baseURL: 'https://other.example/v1' } })
    expect(result.ok).toBe(false)
  })

  it('permits loopback inference without a key and rejects unsafe endpoints', () => {
    expect(validateVoice({ ...config, baseURL: 'http://127.0.0.1:8000/v1' }).baseURL).toContain('127.0.0.1')
    for (const baseURL of ['http://voice.example', 'https://user:secret@voice.example', 'https://voice.example/?key=secret'])
      expect(() => validateVoice({ ...config, baseURL })).toThrow()
  })

  it('returns audio with no playback, rejects redirects and sends credentials only in headers', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/wav' } }))
    const { service } = setup(fetcher)
    const result = await service.execute({ type: 'voice-generate', id: 'test', text: '你好' })
    expect(result).toEqual({ ok: true, audio: { base64: 'AQID', mime: 'audio/wav' } })
    expect(fetcher).toHaveBeenCalledWith('https://voice.example/v1/audio/speech', expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer secret-example' }) }))
  })

  it('cancels even while the credential read is pending', async () => {
    let resolve!: (value: string) => void
    const fetcher = vi.fn()
    const service = new SensesService({ read: () => new Promise(r => resolve = r), write: async () => {} }, fetcher)
    const pending = service.execute({ type: 'voice-generate', id: 'early', text: '你好' })
    await service.execute({ type: 'cancel', id: 'early' })
    resolve(JSON.stringify({ config }))
    expect((await pending).ok).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('sanitizes errors and rejects a non-audio response', async () => {
    const { service } = setup(async () => new Response('secret-example', { headers: { 'content-type': 'text/html' } }))
    expect(await service.execute({ type: 'voice-generate', id: 'invalid', text: '你好' })).toEqual({ ok: false, error: '服务未返回支持的音频格式' })
    const failing = setup(async () => { throw new Error('secret-example') }).service
    expect(JSON.stringify(await failing.execute({ type: 'voice-generate', id: 'error', text: '你好' }))).not.toContain('secret-example')
  })

  it('releases failed requests and bounds unknown-length streams', async () => {
    const { service } = setup(async () => new Response(new Uint8Array(20 * 1024 * 1024 + 1), { headers: { 'content-type': 'audio/wav' } }))
    expect(await service.execute({ type: 'voice-generate', id: 'large', text: '你好' })).toEqual({ ok: false, error: '语音超过 20 MB，请缩短文本' })
    expect((await service.execute({ type: 'voice-configure', config })).ok).toBe(true)
  })
})
