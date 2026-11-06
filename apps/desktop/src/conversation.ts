import { createEndpointer } from './endpointer'
import { MediaSession } from './media-session'
import { pcmWav, toBase64 } from './voice-audio'

export interface ConversationHandlers {
  /** One utterance, as a base64 PCM16 mono 16 kHz WAV. */
  utterance: (wav: string) => void
  /** 'hearing' while someone is speaking, 'listening' otherwise. */
  state: (state: 'listening' | 'hearing') => void
  /** Someone started speaking while her voice was playing. */
  bargeIn: () => void
  /** Her voice is playing: speech must be louder to count, and interrupts her. */
  speaking: () => boolean
  /** Recognising or thinking: what is heard is ignored. */
  paused: () => boolean
  /** The microphone went away (unplugged, permission revoked). */
  ended: () => void
}

const preRollMs = 400
const minUtteranceMs = 350

/**
 * Hands-free listening: the microphone stays open, each utterance is cut where the speaker pauses and handed over as a
 * WAV. Nothing is kept between utterances; `stop` releases the microphone at once.
 */
export async function startConversation(handlers: ConversationHandlers) {
  let stopped = false
  const mic = new MediaSession(navigator.mediaDevices, () => {
    if (!stopped)
      handlers.ended()
  })
  const stream = await mic.open()
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  // ScriptProcessorNode is deprecated but needs no separate worklet file; frames are small enough for endpointing.
  const node = context.createScriptProcessor(1024, 1, 1)
  const frameMs = 1024 / context.sampleRate * 1000
  const vad = createEndpointer({ frameMs })
  const preRoll: Float32Array[] = []
  let current: Float32Array[] | undefined
  node.onaudioprocess = (event) => {
    if (stopped)
      return
    const samples = new Float32Array(event.inputBuffer.getChannelData(0))
    let sum = 0
    for (const sample of samples)
      sum += sample * sample
    const level = Math.sqrt(sum / samples.length)
    preRoll.push(samples)
    while (preRoll.length * frameMs > preRollMs)
      preRoll.shift()
    if (handlers.paused()) {
      if (current)
        handlers.state('listening')
      current = undefined
      vad.reset()
      return
    }
    const speaking = handlers.speaking()
    const change = vad.push(level, speaking ? 4 : 1)
    if (change === 'start') {
      if (speaking)
        handlers.bargeIn()
      current = [...preRoll]
      handlers.state('hearing')
      return
    }
    if (current)
      current.push(samples)
    if (change === 'end' && current) {
      const frames = current
      current = undefined
      handlers.state('listening')
      if (frames.length * frameMs < minUtteranceMs)
        return
      const all = new Float32Array(frames.reduce((total, frame) => total + frame.length, 0))
      let offset = 0
      for (const frame of frames) {
        all.set(frame, offset)
        offset += frame.length
      }
      try { handlers.utterance(toBase64(pcmWav([all], context.sampleRate))) }
      catch {}
    }
  }
  source.connect(node)
  // A script processor only runs while connected to the output; it writes silence there.
  node.connect(context.destination)
  handlers.state('listening')
  return {
    stop() {
      if (stopped)
        return
      stopped = true
      node.onaudioprocess = null
      source.disconnect()
      node.disconnect()
      void context.close().catch(() => {})
      mic.stop()
    },
  }
}
