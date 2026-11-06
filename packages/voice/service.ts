import type { SpeechConfig, VoiceConfig, VoiceReply, VoiceRequest } from './contracts'
import { Buffer } from 'node:buffer'

interface Vault { read: () => Promise<string>, write: (value: string) => Promise<void> }
interface Saved { config?: VoiceConfig, key?: string, recognition?: SpeechConfig, recognitionKey?: string }
class VoiceError extends Error {}

/** One key serves both directions when they use the same service, so a cloud account is entered once. */
function keyFor(saved: Saved, synthesis: boolean): string | undefined {
  const [own, other, ownURL, otherURL] = synthesis
    ? [saved.key, saved.recognitionKey, saved.config?.baseURL, saved.recognition?.baseURL]
    : [saved.recognitionKey, saved.key, saved.recognition?.baseURL, saved.config?.baseURL]
  return own || (ownURL && ownURL === otherURL ? other : undefined) || undefined
}
const audioLimit = 20 * 1024 * 1024
/** MiMo accepts at most 10 MB of base64 audio per recognition request; read as 10,000,000 with the data URL prefix in it. */
const audioPrefix = 'data:audio/wav;base64,'
const chatAudioLimit = 10_000_000 - audioPrefix.length
const base64 = (value: string) => value.length % 4 === 0 && /^[A-Z0-9+/]+={0,2}$/i.test(value)
const audioTypes = ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/ogg', 'audio/flac']

/** Some services label audio as octet-stream or a variant spelling; its own header says what it is. */
function sniffAudio(bytes: Buffer): string | undefined {
  const ascii = (start: number, end: number) => bytes.toString('latin1', start, end)
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE')
    return 'audio/wav'
  // Frame sync, then a version other than reserved (01) and a layer other than reserved (00), which AAC's ADTS uses.
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0 && (bytes[1] & 0x18) !== 0x08 && (bytes[1] & 0x06) !== 0))
    return 'audio/mpeg'
  if (ascii(0, 4) === 'OggS')
    return 'audio/ogg'
  if (ascii(0, 4) === 'fLaC')
    return 'audio/flac'
}

const synthesisTooLarge = '语音超过 20 MB，请缩短文本'
const recognitionTooLarge = '识别结果过大，请缩短录音'

/** What to change, by status. The provider's own text is never shown: it can echo the request. */
function httpError(status: number, baseURL: string): string {
  if (status === 401 || status === 403)
    return `语音服务返回 ${status}：密钥无效或与服务地址不匹配${/(?:^|\.)xiaomimimo\.com$/.test(new URL(baseURL).hostname) ? '（小米 MiMo 的 tp- 密钥用 token-plan-cn 地址，sk- 密钥用 api 地址）' : ''}`
  if (status === 404 || status === 405)
    return `语音服务返回 ${status}：地址或接口格式不对，请确认服务地址，并在“接口格式”中换一种试试`
  return `语音服务返回 ${status}，请检查登录、额度及模型配置`
}

export function validateSpeech(value: SpeechConfig): SpeechConfig {
  const url = new URL(value.baseURL)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const mode = value.mode ?? (loopback ? 'local' : 'cloud')
  if (!['local', 'cloud'].includes(mode) || (mode === 'local' && !loopback) || (url.protocol !== 'https:' && !(mode === 'local' && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash)
    throw new VoiceError('本地部署请填写本机地址；云端 API 须使用 HTTPS。地址不能包含密钥或查询参数。')
  if (typeof value.model !== 'string' || !value.model.trim() || value.model.length > 200)
    throw new VoiceError('请填写语音模型，长度不超过 200 字符')
  const protocol = value.protocol ?? 'audio'
  if (!['audio', 'chat'].includes(protocol))
    throw new VoiceError('未知的语音接口格式')
  return { mode, protocol, baseURL: url.href.replace(/\/+$/, ''), model: value.model.trim() }
}

export function validateSynthesis(value: VoiceConfig): VoiceConfig {
  if (typeof value.voice !== 'string' || !value.voice.trim() || value.voice.length > 200)
    throw new VoiceError('请填写音色，长度不超过 200 字符')
  return { ...validateSpeech(value), voice: value.voice.trim() }
}

async function boundedBody(response: Response, signal: AbortSignal, limit: number, tooLarge: string): Promise<Buffer> {
  if (!response.body)
    throw new VoiceError('语音服务返回空结果')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      if (done)
        break
      length += value.length
      if (length > limit)
        throw new VoiceError(tooLarge)
      chunks.push(value)
    }
  }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  signal.throwIfAborted()
  if (!length)
    throw new VoiceError('语音服务返回空结果')
  return Buffer.concat(chunks)
}

/** Direct local/cloud speech APIs. Stored keys never enter the renderer. No model is started here. */
export class VoiceService {
  private pending = new Map<string, AbortController>()
  private saving = false
  constructor(private vault: Vault, private request: typeof fetch = fetch) {}

  dispose() {
    for (const controller of this.pending.values()) controller.abort()
    this.pending.clear()
  }

  /** Speech in a chat completion: base64 audio on the message for synthesis, its text for recognition. */
  private async chatReply(response: Response, signal: AbortSignal, synthesis: boolean): Promise<VoiceReply> {
    // Base64 of the largest allowed audio, plus room for the rest of the reply.
    // Recognition text may arrive with every Chinese character escaped as \\uXXXX: six bytes each.
    const bytes = await boundedBody(response, signal, synthesis ? Math.ceil(audioLimit / 3) * 4 + 64 * 1024 : 256 * 1024, synthesis ? synthesisTooLarge : recognitionTooLarge)
    let message: { content?: unknown, audio?: { data?: unknown } } | undefined
    try { message = (JSON.parse(bytes.toString('utf8')) as { choices?: { message?: typeof message }[] }).choices?.[0]?.message }
    catch {}
    if (synthesis) {
      const data = message?.audio?.data
      const audio = typeof data === 'string' && base64(data) ? Buffer.from(data, 'base64') : undefined
      const mime = audio && audio.length > 0 && audio.length <= audioLimit ? sniffAudio(audio) : undefined
      if (!audio || !mime)
        throw new VoiceError('服务未返回支持的音频格式')
      return { ok: true, audio: { base64: audio.toString('base64'), mime } }
    }
    if (typeof message?.content !== 'string' || message.content.length > 16000)
      throw new VoiceError('语音服务未返回有效的识别文字')
    return { ok: true, transcript: message.content.trim() }
  }

  async execute(request: VoiceRequest): Promise<VoiceReply> {
    let controller: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let saving = false
    try {
      if (request.type === 'cancel') {
        this.pending.get(request.id)?.abort()
        return { ok: true }
      }
      if (request.type === 'voice-configure' || request.type === 'recognition-configure') {
        if (this.pending.size || this.saving)
          throw new VoiceError('请先停止正在处理的语音，再更换配置')
        this.saving = saving = true
      }
      else if (request.type === 'voice-generate' || request.type === 'voice-transcribe') {
        if (!request.id || request.id.length > 100 || this.pending.has(request.id) || this.pending.size >= 2 || this.saving)
          throw new VoiceError('语音请求重复或仍在处理中')
        controller = new AbortController()
        this.pending.set(request.id, controller)
        timer = setTimeout(() => controller!.abort(), 90_000)
      }
      const saved = JSON.parse(await this.vault.read() || '{}') as Saved
      if (request.type === 'voice-status')
        return { ok: true, config: saved.config ? validateSynthesis(saved.config) : undefined, recognition: saved.recognition ? validateSpeech(saved.recognition) : undefined, hasKey: Boolean(keyFor(saved, true)), recognitionHasKey: Boolean(keyFor(saved, false)) }
      if (request.type === 'voice-configure' || request.type === 'recognition-configure') {
        const synthesis = request.type === 'voice-configure'
        const config = synthesis ? validateSynthesis(request.config) : validateSpeech(request.config)
        const previous = synthesis ? saved.config : saved.recognition
        if (previous && config.baseURL !== previous.baseURL && request.key === undefined)
          throw new VoiceError('更换服务地址时请重新填写密钥；本机无密钥服务可明确清空')
        const key = request.key === undefined ? (synthesis ? saved.key : saved.recognitionKey) : request.key.trim()
        const next = synthesis ? { ...saved, config: config as VoiceConfig, key } : { ...saved, recognition: config, recognitionKey: key }
        await this.vault.write(JSON.stringify(next))
        return { ok: true, config: next.config, recognition: next.recognition, hasKey: Boolean(keyFor(next, true)), recognitionHasKey: Boolean(keyFor(next, false)) }
      }
      if (!controller)
        throw new VoiceError('未知语音操作')
      controller.signal.throwIfAborted()
      const synthesis = request.type === 'voice-generate'
      const config = synthesis ? (saved.config && validateSynthesis(saved.config)) : (saved.recognition && validateSpeech(saved.recognition))
      if (!config)
        throw new VoiceError(synthesis ? '尚未配置语音合成' : '尚未配置语音识别')
      const key = keyFor(saved, synthesis)
      const chat = config.protocol === 'chat'
      let body: string | FormData
      if (request.type === 'voice-generate') {
        if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 2000)
          throw new VoiceError('语音文本需要 1–2000 个字符')
        // The chat protocol speaks the assistant turn, so the text goes there; a user turn would only set the style.
        body = chat
          ? JSON.stringify({ model: config.model, messages: [{ role: 'assistant', content: request.text }], audio: { format: 'wav', voice: (config as VoiceConfig).voice } })
          : JSON.stringify({ model: config.model, voice: (config as VoiceConfig).voice, input: request.text, response_format: 'wav' })
      }
      else if (request.type === 'voice-transcribe') {
        if (typeof request.audio !== 'string' || request.audio.length > Math.ceil(audioLimit / 3) * 4 || (request.audio.length % 4 !== 0 || !/^[A-Z0-9+/]*={0,2}$/i.test(request.audio)))
          throw new VoiceError('请选择不超过 20 MB 的音频')
        const bytes = Buffer.from(request.audio, 'base64')
        if (bytes.length < 44 || bytes.length > audioLimit || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')
          throw new VoiceError('语音识别需要有效的 WAV 音频')
        if (chat) {
          if (request.audio.length > chatAudioLimit)
            throw new VoiceError('这段音频超过此服务约 7.5 MB 的上限，请缩短后再试')
          body = JSON.stringify({ model: config.model, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `${audioPrefix}${request.audio}` } }] }] })
        }
        else {
          body = new FormData()
          body.set('model', config.model)
          body.set('response_format', 'json')
          body.set('file', new Blob([bytes], { type: 'audio/wav' }), 'recording.wav')
        }
      }
      else { throw new VoiceError('未知语音操作') }
      const path = chat ? 'chat/completions' : `audio/${synthesis ? 'speech' : 'transcriptions'}`
      const response = await this.request(`${config.baseURL}/${path}`, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: { ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body,
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new VoiceError(httpError(response.status, config.baseURL))
      }
      if (chat)
        return await this.chatReply(response, controller.signal, synthesis)
      const declared = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
      if (synthesis && !audioTypes.includes(declared) && !['application/octet-stream', 'audio/wave', 'audio/vnd.wave', 'audio/mp3', ''].includes(declared)) {
        await response.body?.cancel()
        throw new VoiceError('服务未返回支持的音频格式')
      }
      const bytes = await boundedBody(response, controller.signal, synthesis ? audioLimit : 64 * 1024, synthesis ? synthesisTooLarge : recognitionTooLarge)
      if (synthesis) {
        const mime = audioTypes.includes(declared) ? declared : sniffAudio(bytes)
        if (!mime)
          throw new VoiceError('服务未返回支持的音频格式')
        return { ok: true, audio: { base64: bytes.toString('base64'), mime } }
      }
      const result = JSON.parse(bytes.toString('utf8')) as { text?: unknown }
      if (typeof result.text !== 'string' || result.text.length > 16000)
        throw new VoiceError('语音服务未返回有效的识别文字')
      return { ok: true, transcript: result.text.trim() }
    }
    catch (error) {
      return { ok: false, error: error instanceof VoiceError ? error.message : '语音请求已取消、超时或连接失败' }
    }
    finally {
      if (timer)
        clearTimeout(timer)
      if (controller && (request.type === 'voice-generate' || request.type === 'voice-transcribe'))
        this.pending.delete(request.id)
      if (saving)
        this.saving = false
    }
  }
}
