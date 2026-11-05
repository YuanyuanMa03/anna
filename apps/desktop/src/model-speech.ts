import type { VoiceReply, VoiceRequest } from '../../../packages/voice/contracts'
import { SpeechSession } from '../../../packages/voice/speech'
import { decodeSpeechEnvelope, envelopeStep } from './speech-envelope'

/** Only model-generated audio reaches this player. No browser/OS speech synthesis. */
export function modelSpeech(invoke: (request: VoiceRequest) => Promise<VoiceReply>, onSpeaking: (value: boolean) => void, onLevel: (value: number) => void = () => {}) {
  let audio: HTMLAudioElement | undefined
  let url: string | undefined
  let finish: (() => void) | undefined
  let meterFrame: number | undefined
  function quiet() {
    if (meterFrame !== undefined)
      cancelAnimationFrame(meterFrame)
    meterFrame = undefined
    onLevel(0)
    onSpeaking(false)
  }
  function stop() {
    quiet()
    audio?.pause()
    if (audio)
      audio.removeAttribute('src')
    audio = undefined
    if (url)
      URL.revokeObjectURL(url)
    url = undefined
    finish?.()
    finish = undefined
  }
  return new SpeechSession({
    stop,
    async synthesize(text, signal) {
      const id = crypto.randomUUID()
      const cancel = () => { void invoke({ type: 'cancel', id }).catch(() => {}) }
      signal.throwIfAborted()
      signal.addEventListener('abort', cancel, { once: true })
      try {
        const reply = await invoke({ type: 'voice-generate', id, text })
        signal.throwIfAborted()
        if (!reply.ok)
          throw new Error(reply.error)
        if (!reply.audio)
          throw new Error('没有收到语音')
        return new Blob([Uint8Array.from(atob(reply.audio.base64), char => char.charCodeAt(0))], { type: reply.audio.mime })
      }
      finally { signal.removeEventListener('abort', cancel) }
    },
    async play(blob, signal) {
      const envelope = await decodeSpeechEnvelope(blob, signal)
      signal.throwIfAborted()
      return new Promise<void>((resolve, reject) => {
        let settled = false
        let playing = false
        let meterEpoch = 0
        let abort: () => void
        const done = (error?: Error) => {
          if (settled)
            return
          settled = true
          playing = false
          signal.removeEventListener('abort', abort)
          finish = undefined
          stop()
          if (error)
            reject(error)
          else resolve()
        }
        abort = () => done()
        finish = () => done()
        url = URL.createObjectURL(blob)
        const player = new Audio(url)
        audio = player
        const measure = (epoch: number) => {
          if (settled || !playing || epoch !== meterEpoch)
            return
          onLevel(envelope?.[Math.floor(player.currentTime / envelopeStep)] ?? 0)
          meterFrame = requestAnimationFrame(() => measure(epoch))
        }
        player.onplaying = () => {
          if (settled || playing)
            return
          playing = true
          onSpeaking(true)
          if (envelope)
            measure(++meterEpoch)
        }
        player.onwaiting = player.onpause = () => {
          if (settled)
            return
          playing = false
          meterEpoch++
          quiet()
        }
        player.onended = () => done()
        player.onerror = () => done(new Error('模型语音无法播放，请检查音频格式和输出设备'))
        signal.addEventListener('abort', abort, { once: true })
        void player.play().catch(() => done(new Error('音频播放未获允许，请手动开启语音后重试')))
      })
    },
  })
}
