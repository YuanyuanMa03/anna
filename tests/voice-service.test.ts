import type { VoiceConfig } from '../packages/voice/contracts'
import { describe, expect, it, vi } from 'vitest'
import { validateSynthesis, VoiceService } from '../packages/voice/service'

const config: VoiceConfig = { baseURL: 'https://voice.example/v1', model: 'chinese-tts', voice: 'anna' }
function setup(request: typeof fetch = vi.fn()) {
  let saved = JSON.stringify({ config, key: 'secret-example' })
  const vault = { read: async () => saved, write: async (value: string) => { saved = value } }
  return { service: new VoiceService(vault, request), vault, saved: () => saved }
}

describe('host voice service', () => {
  it('keeps stored credentials out of status and requires a new key for endpoint changes', async () => {
    const { service } = setup()
    expect(JSON.stringify(await service.execute({ type: 'voice-status' }))).not.toContain('secret-example')
    const result = await service.execute({ type: 'voice-configure', config: { ...config, baseURL: 'https://other.example/v1' } })
    expect(result.ok).toBe(false)
  })

  it('permits loopback inference without a key and rejects unsafe endpoints', () => {
    expect(validateSynthesis({ ...config, baseURL: 'http://127.0.0.1:8000/v1' }).baseURL).toContain('127.0.0.1')
    for (const baseURL of ['http://voice.example', 'https://user:secret@voice.example', 'https://voice.example/?key=secret'])
      expect(() => validateSynthesis({ ...config, baseURL })).toThrow()
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
    const service = new VoiceService({ read: () => new Promise(r => resolve = r), write: async () => {} }, fetcher)
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

// All inference below uses fake HTTP responses and synthetic PCM, never a real provider.
function syntheticWav() {
  const bytes = new Uint8Array(46)
  const view = new DataView(bytes.buffer)
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVEfmt '], [36, 'data']] as const) {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i)
  }
  view.setUint32(4, 38, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 2, true)
  return btoa(String.fromCharCode(...bytes))
}

describe('direct local and cloud recognition', () => {
  it.each(['local', 'cloud'] as const)('sends bounded WAV multipart to the selected %s endpoint without exposing either key', async (mode) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ text: ' 合成测试录音 ' }), { headers: { 'content-type': 'application/json' } }))
    const { service, saved } = setup(fetcher)
    const baseURL = mode === 'local' ? 'http://127.0.0.1:17861/v1' : 'https://asr.example/v1'
    expect((await service.execute({ type: 'recognition-configure', config: { mode, baseURL, model: 'test-asr' }, key: 'asr-secret' })).ok).toBe(true)
    expect(JSON.parse(saved()).key).toBe('secret-example')
    expect(JSON.stringify(await service.execute({ type: 'voice-status' }))).not.toMatch(/asr-secret|secret-example/)
    expect(await service.execute({ type: 'voice-transcribe', id: mode, audio: syntheticWav() })).toEqual({ ok: true, transcript: '合成测试录音' })
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${baseURL}/audio/transcriptions`)
    expect(options.redirect).toBe('error')
    expect(options.headers).toEqual({ Authorization: 'Bearer asr-secret' })
    const body = options.body as FormData
    expect(body.get('model')).toBe('test-asr')
    expect((body.get('file') as File).name).toBe('recording.wav')
  })

  it('preserves legacy TTS settings and infers local mode without rewriting credentials', async () => {
    const { service, saved } = setup()
    const before = saved()
    const reply = await service.execute({ type: 'voice-status' })
    expect(reply).toMatchObject({ ok: true, config: { ...config, mode: 'cloud' }, hasKey: true })
    expect(saved()).toBe(before)
  })

  it('rejects mode/address mismatches and protects recognition keys on endpoint changes', async () => {
    const { service } = setup()
    expect((await service.execute({ type: 'recognition-configure', config: { mode: 'local', baseURL: 'https://remote.example/v1', model: 'asr' } })).ok).toBe(false)
    expect((await service.execute({ type: 'recognition-configure', config: { mode: 'cloud', baseURL: 'http://127.0.0.1:8000/v1', model: 'asr' } })).ok).toBe(false)
    await service.execute({ type: 'recognition-configure', config: { baseURL: 'https://one.example/v1', model: 'asr' }, key: 'asr-secret' })
    expect((await service.execute({ type: 'recognition-configure', config: { baseURL: 'https://two.example/v1', model: 'asr' } })).ok).toBe(false)
    expect((await service.execute({ type: 'recognition-configure', config: { mode: 'local', baseURL: 'http://127.0.0.1:8000/v1', model: 'asr' }, key: '' })).ok).toBe(true)
  })

  it('cancels recognition during credential lookup without uploading audio', async () => {
    let resolve!: (value: string) => void
    const fetcher = vi.fn()
    const service = new VoiceService({ read: () => new Promise(r => resolve = r), write: async () => {} }, fetcher)
    const pending = service.execute({ type: 'voice-transcribe', id: 'cancel-asr', audio: syntheticWav() })
    await service.execute({ type: 'cancel', id: 'cancel-asr' })
    resolve(JSON.stringify({ recognition: { baseURL: 'https://asr.example/v1', model: 'asr' } }))
    expect((await pending).ok).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects invalid audio and bounds recognition output without forwarding provider error text', async () => {
    const fetcher = vi.fn(async () => new Response('secret-example', { status: 401 }))
    const { service } = setup(fetcher)
    await service.execute({ type: 'recognition-configure', config: { baseURL: 'https://asr.example/v1', model: 'asr' }, key: 'asr-secret' })
    expect((await service.execute({ type: 'voice-transcribe', id: 'bad', audio: 'AQID' })).ok).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
    expect(JSON.stringify(await service.execute({ type: 'voice-transcribe', id: 'error', audio: syntheticWav() }))).not.toContain('secret-example')
    fetcher.mockImplementation(async () => new Response('x'.repeat(65537)))
    expect(await service.execute({ type: 'voice-transcribe', id: 'large', audio: syntheticWav() })).toEqual({ ok: false, error: '识别结果过大，请缩短录音' })
  })
})
