import type { VoiceConfig } from '../packages/voice/contracts'
import { Buffer } from 'node:buffer'
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

describe('speech replies with a vague content type', () => {
  it.each([
    ['WAV', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], 'audio/wav'],
    ['MP3', [0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0], 'audio/mpeg'],
    ['Ogg', [0x4F, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0], 'audio/ogg'],
    ['an MP3 frame', [0xFF, 0xFB, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0], 'audio/mpeg'],
  ])('accepts %s audio sent as octet-stream, by its own header', async (_name, bytes, mime) => {
    const { service } = setup(async () => new Response(new Uint8Array(bytes), { headers: { 'content-type': 'application/octet-stream' } }))
    expect(await service.execute({ type: 'voice-generate', id: 'sniff', text: '你好' })).toMatchObject({ ok: true, audio: { mime } })
  })

  it('does not take an AAC header for MP3', async () => {
    const { service } = setup(async () => new Response(new Uint8Array([0xFF, 0xF1, 0x50, 0x80]), { headers: { 'content-type': 'application/octet-stream' } }))
    expect((await service.execute({ type: 'voice-generate', id: 'aac', text: '你好' })).ok).toBe(false)
  })

  it('still rejects something that is not audio', async () => {
    const { service } = setup(async () => new Response('{"error":"quota"}', { headers: { 'content-type': 'application/octet-stream' } }))
    expect(await service.execute({ type: 'voice-generate', id: 'json', text: '你好' })).toEqual({ ok: false, error: '服务未返回支持的音频格式' })
  })
})

describe('one key for one cloud service', () => {
  it('shares across a trailing slash, since saved addresses are normalised', async () => {
    const { service } = setup()
    await service.execute({ type: 'recognition-configure', config: { mode: 'cloud', baseURL: `${config.baseURL}/`, model: 'asr' }, key: '' })
    expect(await service.execute({ type: 'voice-status' })).toMatchObject({ recognitionHasKey: true })
  })

  it('lets recognition use the synthesis key when both go to the same address, and nowhere else', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ text: '你好' }), { headers: { 'content-type': 'application/json' } }))
    const { service } = setup(fetcher)
    expect((await service.execute({ type: 'recognition-configure', config: { mode: 'cloud', baseURL: config.baseURL, model: 'asr' }, key: '' })).ok).toBe(true)
    expect(await service.execute({ type: 'voice-status' })).toMatchObject({ hasKey: true, recognitionHasKey: true })
    await service.execute({ type: 'voice-transcribe', id: 'shared', audio: syntheticWav() })
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ Authorization: 'Bearer secret-example' })
    expect((await service.execute({ type: 'recognition-configure', config: { mode: 'cloud', baseURL: 'https://other.example/v1', model: 'asr' }, key: '' })).ok).toBe(true)
    expect(await service.execute({ type: 'voice-status' })).toMatchObject({ recognitionHasKey: false })
    await service.execute({ type: 'voice-transcribe', id: 'separate', audio: syntheticWav() })
    expect((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].headers).toEqual({})
  })

  it('lets synthesis use the recognition key the same way', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/wav' } }))
    let saved = JSON.stringify({ recognition: { mode: 'cloud', baseURL: config.baseURL, model: 'asr' }, recognitionKey: 'asr-secret' })
    const service = new VoiceService({ read: async () => saved, write: async (value) => { saved = value } }, fetcher)
    expect((await service.execute({ type: 'voice-configure', config })).ok).toBe(true)
    await service.execute({ type: 'voice-generate', id: 'shared', text: '你好' })
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: 'Bearer asr-secret' })
  })
})

// MiMo-style chat protocol: speech goes through /chat/completions. All responses below are fakes.
describe('speech over the chat completions protocol', () => {
  const chatConfig: VoiceConfig = { mode: 'cloud', protocol: 'chat', baseURL: 'https://mimo.example/v1', model: 'mimo-tts', voice: '冰糖' }
  function chatSetup(reply: unknown, status = 200) {
    const fetcher = vi.fn(async () => new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } }))
    let saved = JSON.stringify({ config: chatConfig, key: 'mimo-secret', recognition: { mode: 'cloud', protocol: 'chat', baseURL: chatConfig.baseURL, model: 'mimo-asr' } })
    const service = new VoiceService({ read: async () => saved, write: async (value) => { saved = value } }, fetcher)
    return { service, fetcher }
  }
  const call = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls[0] as unknown as [string, RequestInit]

  it('keeps the protocol it was saved with, and the audio protocol for older settings', () => {
    expect(validateSynthesis(chatConfig).protocol).toBe('chat')
    expect(validateSynthesis(config).protocol).toBe('audio')
    expect(() => validateSynthesis({ ...chatConfig, protocol: 'other' as never })).toThrow()
  })

  it('synthesises with the text as the assistant turn and the voice in the audio options', async () => {
    const wav = Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1').toString('base64')
    const { service, fetcher } = chatSetup({ choices: [{ message: { role: 'assistant', content: '', audio: { data: wav } } }] })
    expect(await service.execute({ type: 'voice-generate', id: 'chat', text: '你好' })).toEqual({ ok: true, audio: { base64: wav, mime: 'audio/wav' } })
    const [url, options] = call(fetcher)
    expect(url).toBe('https://mimo.example/v1/chat/completions')
    expect(options.redirect).toBe('error')
    expect(options.headers).toMatchObject({ 'Content-Type': 'application/json', 'Authorization': 'Bearer mimo-secret' })
    expect(JSON.parse(options.body as string)).toEqual({ model: 'mimo-tts', messages: [{ role: 'assistant', content: '你好' }], audio: { format: 'wav', voice: '冰糖' } })
  })

  it.each([
    ['no audio', { choices: [{ message: { content: 'sorry' } }] }],
    ['audio that is not audio', { choices: [{ message: { audio: { data: Buffer.from('{"error":1}').toString('base64') } } }] }],
    ['a broken body', '{"choices": ['],
    ['truncated base64', { choices: [{ message: { audio: { data: Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1').toString('base64').slice(0, -1) } } }] }],
  ])('rejects a reply with %s', async (_name, reply) => {
    const { service } = chatSetup(reply)
    expect(await service.execute({ type: 'voice-generate', id: 'bad', text: '你好' })).toEqual({ ok: false, error: '服务未返回支持的音频格式' })
  })

  it('recognises by sending the WAV as an input_audio data URL and reading the reply text', async () => {
    const { service, fetcher } = chatSetup({ choices: [{ message: { role: 'assistant', content: ' 你好，我是安娜。 ' } }] })
    const audio = syntheticWav()
    expect(await service.execute({ type: 'voice-transcribe', id: 'chat-asr', audio })).toEqual({ ok: true, transcript: '你好，我是安娜。' })
    const [url, options] = call(fetcher)
    expect(url).toBe('https://mimo.example/v1/chat/completions')
    expect(options.headers).toMatchObject({ Authorization: 'Bearer mimo-secret' })
    expect(JSON.parse(options.body as string)).toEqual({ model: 'mimo-asr', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${audio}` } }] }] })
  })

  it('names the synthesis limit, not the recognition one, when a reply is too large', async () => {
    const { service } = chatSetup({ choices: [{ message: { audio: { data: 'A'.repeat(28 * 1024 * 1024) } } }] })
    expect(await service.execute({ type: 'voice-generate', id: 'huge', text: '你好' })).toEqual({ ok: false, error: '语音超过 20 MB，请缩短文本' })
  })

  it.each([
    [401, /密钥无效或与服务地址不匹配$/],
    [403, /密钥无效或与服务地址不匹配/],
    [404, /接口格式/],
    [405, /接口格式/],
    [429, /额度/],
  ])('explains HTTP %i in terms of what to change', async (status, message) => {
    const { service } = chatSetup({ error: 'x' }, status)
    const reply = await service.execute({ type: 'voice-generate', id: `s${status}`, text: '你好' })
    expect(reply.ok).toBe(false)
    expect((reply as { error: string }).error).toMatch(message)
  })

  it('names MiMo\'s two key kinds only for a MiMo address', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 401 }))
    let saved = JSON.stringify({ config: { mode: 'cloud', protocol: 'chat', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', model: 'm', voice: 'v' }, key: 'k' })
    const service = new VoiceService({ read: async () => saved, write: async (value) => { saved = value } }, fetcher)
    expect(await service.execute({ type: 'voice-generate', id: 'mimo', text: '你好' })).toMatchObject({ ok: false, error: expect.stringContaining('tp-') })

    saved = JSON.stringify({ config: { mode: 'cloud', protocol: 'chat', baseURL: 'https://evilxiaomimimo.com/v1', model: 'm', voice: 'v' }, key: 'k' })
    expect(await service.execute({ type: 'voice-generate', id: 'other', text: '你好' })).toMatchObject({ ok: false, error: expect.not.stringContaining('tp-') })
  })

  it('accepts a recognition reply with every character escaped, well past 64 KiB', async () => {
    const text = '好'.repeat(15000)
    const body = JSON.stringify({ choices: [{ message: { content: text } }] }).replace(/好/g, '\\u597d')
    const { service } = chatSetup(body)
    expect(body.length).toBeGreaterThan(64 * 1024)
    expect(await service.execute({ type: 'voice-transcribe', id: 'escaped', audio: syntheticWav() })).toEqual({ ok: true, transcript: text })
  })

  it('accepts recognition audio just inside the service limit, data URL prefix included', async () => {
    const { service, fetcher } = chatSetup({ choices: [{ message: { content: '好' } }] })
    const header = Buffer.from(syntheticWav(), 'base64')
    const fits = Math.floor((10_000_000 - 'data:audio/wav;base64,'.length) / 4) * 3
    const audio = Buffer.concat([header, Buffer.alloc(fits - header.length)]).toString('base64')
    expect((await service.execute({ type: 'voice-transcribe', id: 'fits', audio })).ok).toBe(true)
    expect(JSON.parse((call(fetcher)[1].body as string)).messages[0].content[0].input_audio.data.length).toBeLessThanOrEqual(10_000_000)
  })

  it('refuses audio over the service\'s 10 MB base64 limit before uploading it', async () => {
    const { service, fetcher } = chatSetup({ choices: [{ message: { content: 'x' } }] })
    const header = Buffer.from(syntheticWav(), 'base64')
    const audio = Buffer.concat([header, Buffer.alloc(8 * 1024 * 1024)]).toString('base64')
    expect(await service.execute({ type: 'voice-transcribe', id: 'long', audio })).toEqual({ ok: false, error: '这段音频超过此服务约 7.5 MB 的上限，请缩短后再试' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a recognition reply without text and hides provider errors', async () => {
    expect((await chatSetup({ choices: [{ message: { content: null } }] }).service.execute({ type: 'voice-transcribe', id: 'empty', audio: syntheticWav() })).ok).toBe(false)
    const failing = await chatSetup({ error: 'mimo-secret quota' }, 429).service.execute({ type: 'voice-transcribe', id: 'quota', audio: syntheticWav() })
    expect(failing.ok).toBe(false)
    expect(JSON.stringify(failing)).not.toContain('mimo-secret')
  })
})
