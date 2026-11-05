import type { SpeechConfig, VoiceConfig, VoiceReply, VoiceRequest } from './contracts'
import { Buffer } from 'node:buffer'

interface Vault { read: () => Promise<string>, write: (value: string) => Promise<void> }
interface Saved { config?: VoiceConfig, key?: string, recognition?: SpeechConfig, recognitionKey?: string }
class VoiceError extends Error {}
const audioLimit = 20 * 1024 * 1024

export function validateSpeech(value: SpeechConfig): SpeechConfig {
  const url = new URL(value.baseURL)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const mode = value.mode ?? (loopback ? 'local' : 'cloud')
  if (!['local', 'cloud'].includes(mode) || (mode === 'local' && !loopback) || (url.protocol !== 'https:' && !(mode === 'local' && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash)
    throw new VoiceError('本地部署请填写本机地址；云端 API 须使用 HTTPS。地址不能包含密钥或查询参数。')
  if (typeof value.model !== 'string' || !value.model.trim() || value.model.length > 200)
    throw new VoiceError('请填写语音模型，长度不超过 200 字符')
  return { mode, baseURL: url.href.replace(/\/+$/, ''), model: value.model.trim() }
}

export function validateSynthesis(value: VoiceConfig): VoiceConfig {
  if (typeof value.voice !== 'string' || !value.voice.trim() || value.voice.length > 200)
    throw new VoiceError('请填写音色，长度不超过 200 字符')
  return { ...validateSpeech(value), voice: value.voice.trim() }
}

async function boundedBody(response: Response, signal: AbortSignal, limit: number): Promise<Buffer> {
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
        throw new VoiceError(limit === audioLimit ? '语音超过 20 MB，请缩短文本' : '识别结果过大，请缩短录音')
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
        return { ok: true, config: saved.config ? validateSynthesis(saved.config) : undefined, recognition: saved.recognition ? validateSpeech(saved.recognition) : undefined, hasKey: Boolean(saved.key), recognitionHasKey: Boolean(saved.recognitionKey) }
      if (request.type === 'voice-configure' || request.type === 'recognition-configure') {
        const synthesis = request.type === 'voice-configure'
        const config = synthesis ? validateSynthesis(request.config) : validateSpeech(request.config)
        const previous = synthesis ? saved.config : saved.recognition
        if (previous && config.baseURL !== previous.baseURL && request.key === undefined)
          throw new VoiceError('更换服务地址时请重新填写密钥；本机无密钥服务可明确清空')
        const key = request.key === undefined ? (synthesis ? saved.key : saved.recognitionKey) : request.key.trim()
        const next = synthesis ? { ...saved, config: config as VoiceConfig, key } : { ...saved, recognition: config, recognitionKey: key }
        await this.vault.write(JSON.stringify(next))
        return { ok: true, config: next.config, recognition: next.recognition, hasKey: Boolean(next.key), recognitionHasKey: Boolean(next.recognitionKey) }
      }
      if (!controller)
        throw new VoiceError('未知语音操作')
      controller.signal.throwIfAborted()
      const synthesis = request.type === 'voice-generate'
      const config = synthesis ? (saved.config && validateSynthesis(saved.config)) : (saved.recognition && validateSpeech(saved.recognition))
      if (!config)
        throw new VoiceError(synthesis ? '尚未配置语音合成' : '尚未配置语音识别')
      const key = synthesis ? saved.key : saved.recognitionKey
      let body: string | FormData
      if (request.type === 'voice-generate') {
        if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 2000)
          throw new VoiceError('语音文本需要 1–2000 个字符')
        body = JSON.stringify({ model: config.model, voice: (config as VoiceConfig).voice, input: request.text, response_format: 'wav' })
      }
      else if (request.type === 'voice-transcribe') {
        if (typeof request.audio !== 'string' || request.audio.length > Math.ceil(audioLimit / 3) * 4 || (request.audio.length % 4 !== 0 || !/^[A-Z0-9+/]*={0,2}$/i.test(request.audio)))
          throw new VoiceError('请选择不超过 20 MB 的音频')
        const bytes = Buffer.from(request.audio, 'base64')
        if (bytes.length < 44 || bytes.length > audioLimit || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')
          throw new VoiceError('语音识别需要有效的 WAV 音频')
        body = new FormData()
        body.set('model', config.model)
        body.set('response_format', 'json')
        body.set('file', new Blob([bytes], { type: 'audio/wav' }), 'recording.wav')
      }
      else { throw new VoiceError('未知语音操作') }
      const response = await this.request(`${config.baseURL}/audio/${synthesis ? 'speech' : 'transcriptions'}`, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: { ...(synthesis ? { 'Content-Type': 'application/json' } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body,
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new VoiceError(`语音服务返回 ${response.status}，请检查登录、额度及模型配置`)
      }
      const mime = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
      if (synthesis && !['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/ogg', 'audio/flac'].includes(mime)) {
        await response.body?.cancel()
        throw new VoiceError('服务未返回支持的音频格式')
      }
      const bytes = await boundedBody(response, controller.signal, synthesis ? audioLimit : 64 * 1024)
      if (synthesis)
        return { ok: true, audio: { base64: bytes.toString('base64'), mime } }
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
