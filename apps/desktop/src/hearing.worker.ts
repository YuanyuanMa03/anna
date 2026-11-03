import type { OnlineRecognizer } from '@sherpaw/asr'
import { createOnlineRecognizer, initASRModule, OnlineRecognizerTypes } from '@sherpaw/asr'
import { loadData } from '@sherpaw/preloader'
import { hearingMetadata } from '../../../packages/senses/hearing'

let recognizer: OnlineRecognizer | undefined
globalThis.onmessage = async ({ data }) => {
  const id = data.id
  try {
    if (data.type === 'probe') {
      await initASRModule()
      globalThis.postMessage({ id, runtime: true })
    }
    else if (data.type === 'load') {
      const metadata = hearingMetadata(data.metadata, data.model.byteLength)
      recognizer?.free()
      recognizer = undefined
      const module = await initASRModule()
      loadData({ module, metadata, data: data.model })
      recognizer = createOnlineRecognizer(module, { type: OnlineRecognizerTypes.Paraformer, modelConfig: { modelingUnit: 'cjkchar', debug: 0 } })
      globalThis.postMessage({ id, ready: true })
    }
    else if (data.type === 'transcribe') {
      if (!recognizer)
        throw new Error('请先加载本地模型')
      const samples = data.samples as Float32Array
      if (!(samples instanceof Float32Array) || !samples.length || samples.length > 16000 * 120)
        throw new Error('音频长度无效')
      const stream = recognizer.createStream()
      try {
        // Decode in chunks to avoid accumulating an entire recording in native feature extraction.
        for (let i = 0; i < samples.length; i += 1600) {
          stream.acceptWaveform(16000, samples.subarray(i, i + 1600))
          while (recognizer.isReady(stream)) recognizer.decode(stream)
        }
        stream.acceptWaveform(16000, new Float32Array(16000))
        stream.inputFinished()
        while (recognizer.isReady(stream)) recognizer.decode(stream)
        globalThis.postMessage({ id, text: String(recognizer.getResult(stream).text ?? '') })
      }
      finally { stream.free() }
    }
    else { throw new Error('未知听觉操作') }
  }
  catch { globalThis.postMessage({ id, error: '本地识别失败，请检查模型包、音频及设备可用内存' }) }
}
