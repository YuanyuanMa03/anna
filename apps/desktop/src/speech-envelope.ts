/** Loudness from the generated audio, sampled every 20 ms. No microphone or output graph. */
export const envelopeStep = 0.02

export function speechEnvelope(channels: readonly Float32Array[], sampleRate: number): Float32Array {
  const size = Math.max(1, Math.round(sampleRate * envelopeStep))
  const length = channels[0]?.length ?? 0
  const levels = new Float32Array(Math.ceil(length / size))
  for (let frame = 0; frame < levels.length; frame++) {
    const start = frame * size
    const end = Math.min(length, start + size)
    let power = 0
    for (const channel of channels) {
      for (let index = start; index < end; index++)
        power += (channel[index] ?? 0) ** 2
    }
    const rms = Math.sqrt(power / ((end - start) * channels.length))
    // Ignore near-silence; keep normal speech readable without opening the mouth fully.
    levels[frame] = Math.min(1, Math.max(0, (rms - 0.008) * 5))
  }
  return levels
}

/** Decode only: OfflineAudioContext cannot play to speakers. Playback remains on the original audio element. */
export async function decodeSpeechEnvelope(blob: Blob, signal: AbortSignal): Promise<Float32Array | undefined> {
  if (typeof OfflineAudioContext === 'undefined')
    return undefined
  try {
    const context = new OfflineAudioContext(1, 1, 24000)
    const bytes = await blob.arrayBuffer()
    signal.throwIfAborted()
    const audio = await context.decodeAudioData(bytes)
    signal.throwIfAborted()
    return speechEnvelope(Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel)), audio.sampleRate)
  }
  catch (error) {
    if (signal.aborted)
      throw error
    // Unsupported analysis must not prevent the original audio from playing or invent a mouth rhythm.
    return undefined
  }
}
