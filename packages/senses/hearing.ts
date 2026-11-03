/** AIRI-compatible Sherpaw preload pair; validate before writing into the isolated WASM filesystem. */
export interface HearingMetadata { remote_package_size: number, files: { filename: string, start: number, end: number }[] }
export function hearingMetadata(value: unknown, size: number): HearingMetadata {
  const data = value as HearingMetadata
  if (!data || size <= 0 || size > 600 * 1024 * 1024 || data.remote_package_size !== size || !Array.isArray(data.files) || data.files.length !== 3)
    throw new Error('模型包大小或文件数量不符合中英文 Paraformer 格式')
  const names = new Set(['encoder.onnx', 'decoder.onnx', 'tokens.txt'])
  const ranges: [number, number][] = []
  for (const file of data.files) {
    const name = file.filename.replace(/^\//, '')
    if (!names.delete(name) || !Number.isSafeInteger(file.start) || !Number.isSafeInteger(file.end) || file.start < 0 || file.end <= file.start || file.end > size)
      throw new Error('模型元数据包含无效文件名或范围')
    ranges.push([file.start, file.end])
  }
  ranges.sort((a, b) => a[0] - b[0])
  if (ranges.some((range, i) => i > 0 && range[0] < ranges[i - 1]![1]))
    throw new Error('模型文件范围重叠')
  return { remote_package_size: size, files: data.files.map(file => ({ ...file, filename: file.filename.replace(/^\//, '') })) }
}

/** Downmix and resample with a bounded output; no audio is played. */
export function mono16k(channels: Float32Array[], sampleRate: number): Float32Array {
  if (!channels.length || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || channels.length > 8)
    throw new Error('不支持的音频采样率或声道')
  const length = channels[0]!.length
  if (!length || length / sampleRate > 120 || channels.some(channel => channel.length !== length))
    throw new Error('请选择不超过两分钟的音频')
  const output = new Float32Array(Math.ceil(length * 16000 / sampleRate))
  for (let i = 0; i < output.length; i++) {
    const position = i * sampleRate / 16000
    const start = Math.floor(position)
    const end = Math.min(start + 1, length - 1)
    let value = 0
    for (const channel of channels) value += channel[start]! * (1 - (position - start)) + channel[end]! * (position - start)
    // Keep input at PCM16 precision across browser decoders before feeding the recognizer.
    output[i] = Number.isFinite(value) ? Math.max(-32768, Math.min(32767, Math.round(value / channels.length * 32768))) / 32768 : 0
  }
  return output
}
