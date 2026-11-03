import type { SenseReply, SenseRequest } from '../../../packages/senses/contracts'
import { SpeechSession } from '../../../packages/senses/speech'

/** Only model-generated audio reaches this player. No browser/OS speech synthesis. */
export function modelSpeech(invoke: (request: SenseRequest) => Promise<SenseReply>, onSpeaking: (value: boolean) => void) {
  let audio: HTMLAudioElement | undefined
  let url: string | undefined
  let finish: (() => void) | undefined
  function stop() {
    audio?.pause()
    if (audio)
      audio.removeAttribute('src')
    audio = undefined
    if (url)
      URL.revokeObjectURL(url)
    url = undefined
    onSpeaking(false)
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
    play(blob, signal) {
      signal.throwIfAborted()
      return new Promise<void>((resolve, reject) => {
        let settled = false
        let abort: () => void
        const done = (error?: Error) => {
          if (settled)
            return
          settled = true
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
        player.onplaying = () => {
          if (!settled)
            onSpeaking(true)
        }
        player.onended = () => done()
        player.onerror = () => done(new Error('模型语音无法播放，请检查音频格式和输出设备'))
        signal.addEventListener('abort', abort, { once: true })
        void player.play().catch(() => done(new Error('音频播放未获允许，请手动开启语音后重试')))
      })
    },
  })
}
