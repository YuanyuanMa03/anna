import type { SenseReply, SenseRequest, VoiceConfig } from './contracts'
import { Buffer } from 'node:buffer'

interface Vault { read: () => Promise<string>, write: (value: string) => Promise<void> }
class SenseError extends Error {}
const audioLimit = 20 * 1024 * 1024

export function validateVoice(value: VoiceConfig): VoiceConfig {
  const url = new URL(value.baseURL)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash)
    throw new SenseError('语音端点须为 HTTPS；本机服务可使用 HTTP。地址不能包含密钥或查询参数。')
  if (!value.model?.trim() || value.model.length > 200 || !value.voice?.trim() || value.voice.length > 200)
    throw new SenseError('请填写语音模型和音色，长度不超过 200 字符')
  return { baseURL: url.href.replace(/\/+$/, ''), model: value.model.trim(), voice: value.voice.trim() }
}

/** Audio requests stay in the Host process; the renderer never receives stored credentials. */
export class SensesService {
  private pending = new Map<string, AbortController>()
  constructor(private vault: Vault, private request: typeof fetch = fetch) {}

  dispose() {
    for (const controller of this.pending.values()) controller.abort()
    this.pending.clear()
  }

  async execute(request: SenseRequest): Promise<SenseReply> {
    let generation: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (request.type === 'voice-generate') {
        if (!request.id || request.id.length > 100 || this.pending.has(request.id) || this.pending.size >= 2)
          throw new SenseError('语音请求重复或仍在处理中')
        generation = new AbortController()
        this.pending.set(request.id, generation)
        timer = setTimeout(() => generation!.abort(), 90_000)
      }
      if (request.type === 'cancel') {
        this.pending.get(request.id)?.abort()
        return { ok: true }
      }
      const saved = JSON.parse(await this.vault.read() || '{}') as { config?: VoiceConfig, key?: string }
      if (request.type === 'voice-status')
        return { ok: true, config: saved.config, hasKey: Boolean(saved.key) }
      if (request.type === 'voice-configure') {
        if (this.pending.size)
          throw new SenseError('请先停止正在生成的语音，再更换配置')
        const config = validateVoice(request.config)
        const key = request.key === undefined ? saved.key : request.key.trim()
        // Changing endpoints cannot silently forward a previous provider's credential.
        if (saved.config && config.baseURL !== saved.config.baseURL && request.key === undefined)
          throw new SenseError('更换服务地址时请重新填写密钥；本机无密钥服务可明确清空')
        await this.vault.write(JSON.stringify({ config, key }))
        return { ok: true, config, hasKey: Boolean(key) }
      }
      if (request.type !== 'voice-generate')
        throw new SenseError('未知感官操作')
      if (!saved.config)
        throw new SenseError('尚未配置语音模型')
      const config = validateVoice(saved.config)
      if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 2000)
        throw new SenseError('语音文本需要 1–2000 个字符')
      const controller = generation!
      controller.signal.throwIfAborted()
      {
        const response = await this.request(`${config.baseURL}/audio/speech`, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...(saved.key ? { Authorization: `Bearer ${saved.key}` } : {}) },
          body: JSON.stringify({ model: config.model, voice: config.voice, input: request.text, response_format: 'wav' }),
        })
        if (!response.ok) {
          await response.body?.cancel()
          throw new SenseError(`语音服务返回 ${response.status}，请检查登录、额度及模型配置`)
        }
        const mime = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
        if (!['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/ogg', 'audio/flac'].includes(mime) || !response.body) {
          await response.body?.cancel()
          throw new SenseError('服务未返回支持的音频格式')
        }
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let length = 0
        try {
          while (true) {
            controller.signal.throwIfAborted()
            const { value, done } = await reader.read()
            if (done)
              break
            length += value.length
            if (length > audioLimit)
              throw new SenseError('语音超过 20 MB，请缩短文本')
            chunks.push(value)
          }
        }
        finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
        controller.signal.throwIfAborted()
        if (!length)
          throw new SenseError('语音服务返回空音频')
        return { ok: true, audio: { base64: Buffer.concat(chunks).toString('base64'), mime } }
      }
    }
    catch (error) {
      // Never expose a provider response, URL or fetch error containing a credential.
      return { ok: false, error: error instanceof SenseError ? error.message : '语音请求已取消、超时或连接失败' }
    }
    finally {
      if (timer)
        clearTimeout(timer)
      if (generation && request.type === 'voice-generate')
        this.pending.delete(request.id)
    }
  }
}
