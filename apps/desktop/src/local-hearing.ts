import type { SenseReply, SenseRequest } from '../../../packages/senses/contracts'
import type { HearingMetadata } from '../../../packages/senses/hearing'
import { hearingMetadata, mono16k } from '../../../packages/senses/hearing'

/** A terminated Worker releases model memory and cannot deliver a stale transcript. */
export class LocalHearing {
  private worker?: Worker
  private next = 0
  private revision = 0
  private pending?: { reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }
  ready = false
  stop() {
    this.revision++
    this.ready = false
    this.worker?.terminate()
    this.worker = undefined
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.reject(new Error('本地识别已取消'))
      this.pending = undefined
    }
  }

  private call(payload: object, transfer: Transferable[]) {
    if (!this.worker || this.pending)
      throw new Error('听觉未就绪或仍在处理中')
    const worker = this.worker
    const id = ++this.next
    return new Promise<{ text?: string }>((resolve, reject) => {
      const finish = (error?: string, value?: { text?: string }) => {
        if (!this.pending || this.worker !== worker)
          return
        clearTimeout(this.pending.timer)
        this.pending = undefined
        if (error) { this.stop(); reject(new Error(error)) }
        else {
          resolve(value ?? {})
        }
      }
      worker.onmessage = ({ data }) => {
        if (data.id === id)
          finish(data.error, data)
      }
      worker.onerror = () => finish('本地识别运行时无法启动')
      this.pending = { reject, timer: setTimeout(() => finish('本地识别超时，已释放模型'), 120000) }
      try { worker.postMessage({ ...payload, id }, transfer) }
      catch { finish('无法传送模型或音频') }
    })
  }

  async probe() {
    this.stop()
    this.worker = new Worker(new URL('./hearing.worker.ts', import.meta.url), { type: 'module' })
    try { await this.call({ type: 'probe' }, []) }
    finally { this.stop() }
  }

  async load(metadataFile: File, modelFile: File) {
    this.stop()
    const revision = this.revision
    if (metadataFile.size > 65536 || modelFile.size > 600 * 1024 * 1024)
      throw new Error('模型包过大')
    const metadata = hearingMetadata(JSON.parse(await metadataFile.text()), modelFile.size)
    const model = await modelFile.arrayBuffer()
    await this.startModel(metadata, model, revision)
  }

  private async startModel(metadata: HearingMetadata, model: ArrayBuffer, revision: number) {
    if (revision !== this.revision)
      throw new Error('模型加载已取消')
    this.worker = new Worker(new URL('./hearing.worker.ts', import.meta.url), { type: 'module' })
    await this.call({ type: 'load', metadata, model }, [model])
    this.ready = true
  }

  async loadSaved(invoke: (request: SenseRequest) => Promise<SenseReply>, progress: (percent: number) => void) {
    this.stop()
    const revision = this.revision
    const status = await invoke({ type: 'hearing-status' })
    if (revision !== this.revision)
      throw new Error('模型加载已取消')
    if (!status.ok || !status.hearingModel)
      throw new Error(status.ok ? '请先导入本地模型包' : status.error)
    const saved = status.hearingModel
    const metadata = hearingMetadata(saved.metadata, saved.size)
    const model = new Uint8Array(saved.size)
    for (let offset = 0; offset < saved.size;) {
      const reply = await invoke({ type: 'hearing-read', id: saved.id, offset })
      if (revision !== this.revision)
        throw new Error('模型加载已取消')
      if (!reply.ok || !reply.chunk)
        throw new Error(reply.ok ? '本地模型数据不完整，请重新导入' : reply.error)
      const bytes = Uint8Array.from(atob(reply.chunk), c => c.charCodeAt(0))
      if (bytes.length !== Math.min(1024 * 1024, saved.size - offset))
        throw new Error('本地模型数据不完整，请重新导入')
      model.set(bytes, offset)
      offset += bytes.length
      progress(Math.round(offset / saved.size * 100))
    }
    const digest = await crypto.subtle.digest('SHA-256', model)
    if (Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') !== saved.sha256)
      throw new Error('本地模型校验失败，请重新导入')
    await this.startModel(metadata, model.buffer, revision)
  }

  async transcribe(file: File) {
    if (!this.ready)
      throw new Error('请先加载本地模型')
    if (file.size > 20 * 1024 * 1024)
      throw new Error('音频不能超过 20 MB')
    const revision = this.revision
    const decoder = new OfflineAudioContext(1, 1, 16000)
    const audio = await decoder.decodeAudioData(await file.arrayBuffer())
    if (revision !== this.revision)
      throw new Error('本地识别已取消')
    const samples = mono16k(Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i)), audio.sampleRate)
    return (await this.call({ type: 'transcribe', samples }, [samples.buffer])).text ?? ''
  }
}
