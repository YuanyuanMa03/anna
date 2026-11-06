/** Convert browser-supported recordings to a portable PCM16 mono WAV, without playback or model runtimes. */
export function pcmWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const length = channels[0]?.length ?? 0
  if (!channels.length || channels.length > 8 || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !length || length / sampleRate > 120 || channels.some(channel => channel.length !== length))
    throw new Error('请选择不超过两分钟的有效音频')
  const samples = Math.ceil(length * 16000 / sampleRate)
  const bytes = new Uint8Array(44 + samples * 2)
  const view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i) }
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) {
    const position = Math.min(i * sampleRate / 16000, length - 1)
    const start = Math.floor(position)
    const end = Math.min(start + 1, length - 1)
    let value = 0
    for (const channel of channels) {
      const first = Number.isFinite(channel[start]) ? channel[start]! : 0
      const last = Number.isFinite(channel[end]) ? channel[end]! : 0
      value += first * (1 - (position - start)) + last * (position - start)
    }
    value /= channels.length
    view.setInt16(44 + i * 2, Number.isFinite(value) ? Math.max(-32768, Math.min(32767, Math.round(value * 32768))) : 0, true)
  }
  return bytes
}

export async function recordingWav(file: Blob, signal: AbortSignal): Promise<string> {
  if (!file.size || file.size > 20 * 1024 * 1024)
    throw new Error('请选择不超过 20 MB 的音频')
  signal.throwIfAborted()
  const context = new OfflineAudioContext(1, 1, 16000)
  const decoded = await context.decodeAudioData(await file.arrayBuffer())
  signal.throwIfAborted()
  return toBase64(pcmWav(Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index)), decoded.sampleRate))
}

export function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return btoa(binary)
}
