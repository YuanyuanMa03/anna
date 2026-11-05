/**
 * Speech lifecycle inspired by AIRI's pipelines-audio speech-pipeline.ts.
 * Source: moeru-ai/airi@d359045916a55e40e056f293fc81814bac0e9244 (MIT).
 * Copyright (c) 2024-PRESENT Neko Ayaka. See assets/licenses/AIRI-MIT.txt.
 * Anna adaptation: one ordered turn, explicit cancellation, no system speech.
 */
export interface SpeechOutput {
  synthesize: (text: string, signal: AbortSignal) => Promise<Blob>
  play: (audio: Blob, signal: AbortSignal) => Promise<void>
  stop: () => void
}

/** Sentence boundaries keep Chinese replies responsive without dropping a long tail. */
export function speechSegments(text: string): string[] {
  const plain = text.replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*#`]/g, '')
  return (plain.match(/[^。！？!?\n]+[。！？!?\n]?/g) ?? []).flatMap((sentence) => {
    const chars = Array.from(sentence.trim())
    const parts: string[] = []
    for (let i = 0; i < chars.length; i += 160)
      parts.push(chars.slice(i, i + 160).join(''))
    return parts
  })
}

/** Providers and playback are injected: constructing a session cannot capture or play audio. */
export class SpeechSession {
  private current?: AbortController
  constructor(private output: SpeechOutput) {}

  stop() {
    this.current?.abort()
    this.current = undefined
    this.output.stop()
  }

  async speak(text: string): Promise<void> {
    this.stop()
    const controller = new AbortController()
    this.current = controller
    const { signal } = controller
    try {
      for (const segment of speechSegments(text)) {
        signal.throwIfAborted()
        const audio = await this.output.synthesize(segment, signal)
        signal.throwIfAborted()
        await this.output.play(audio, signal)
        signal.throwIfAborted()
      }
    }
    catch (error) {
      if (!signal.aborted)
        throw error
    }
    finally {
      if (this.current === controller)
        this.current = undefined
    }
  }
}
