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

  private prepare(segment: string, signal: AbortSignal): Promise<Blob> {
    const audio = this.output.synthesize(segment, signal)
    // Handled when awaited; until then, an early failure must not count as unhandled.
    audio.catch(() => {})
    return audio
  }

  async speak(text: string): Promise<void> {
    this.stop()
    const controller = new AbortController()
    this.current = controller
    const { signal } = controller
    try {
      // The next sentence is synthesised while this one plays: a cloud request takes seconds, a pause between every
      // sentence would be heard. Its failure is kept until playback reaches it.
      const segments = speechSegments(text)
      let next = segments.length ? this.prepare(segments[0]!, signal) : undefined
      for (let index = 0; next; index++) {
        signal.throwIfAborted()
        const audio = await next
        next = index + 1 < segments.length ? this.prepare(segments[index + 1]!, signal) : undefined
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
      // A sentence prepared ahead must not keep its request (and a service slot) after a failure.
      controller.abort()
      if (this.current === controller)
        this.current = undefined
    }
  }
}
