import type { SenseReply, SenseRequest } from '../packages/senses/contracts'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { LocalHearing } from '../apps/desktop/src/local-hearing'

class TestWorker {
  static instances: TestWorker[] = []
  onmessage?: (event: { data: object }) => void
  terminate = vi.fn()
  postMessage = vi.fn((data: { id: number, type: string }) => {
    queueMicrotask(() => this.onmessage?.({ data: { id: data.id, text: '测试转写' } }))
  })

  constructor() { TestWorker.instances.push(this) }
}
const pack = { remote_package_size: 3, files: [{ filename: 'encoder.onnx', start: 0, end: 1 }, { filename: 'decoder.onnx', start: 1, end: 2 }, { filename: 'tokens.txt', start: 2, end: 3 }] }
const metadata = new File([JSON.stringify(pack)], 'preload.js.metadata')
const model = new File([new Uint8Array(3)], 'preload.data')
afterEach(() => { vi.unstubAllGlobals(); TestWorker.instances = [] })

it('discards audio decoded after stop and model replacement instead of sending it to the new Worker', async () => {
  vi.stubGlobal('Worker', TestWorker)
  let finish!: (audio: object) => void
  const decode = vi.fn(() => new Promise((resolve) => { finish = resolve }))
  vi.stubGlobal('OfflineAudioContext', class { decodeAudioData = decode })
  const hearing = new LocalHearing()
  await hearing.load(metadata, model)
  const old = hearing.transcribe(new File(['audio'], 'recording.wav'))
  const rejected = expect(old).rejects.toThrow('取消')
  await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce())
  hearing.stop()
  await hearing.load(metadata, model)
  finish({ numberOfChannels: 1, sampleRate: 16000, getChannelData: () => new Float32Array(160) })
  await rejected
  expect(TestWorker.instances[1]!.postMessage).toHaveBeenCalledTimes(1)
  expect(hearing.ready).toBe(true)
  hearing.stop()
})

function savedModel() {
  const bytes = Buffer.from([1, 2, 3])
  const record = { id: 'saved', size: bytes.length, metadata: pack, sha256: createHash('sha256').update(bytes).digest('hex') }
  const invoke = vi.fn(async (request: SenseRequest): Promise<SenseReply> => request.type === 'hearing-status' ? { ok: true, hearingModel: record } : { ok: true, chunk: bytes.toString('base64') })
  return { record, invoke, bytes }
}

it('verifies persisted model bytes before transferring them to the recognition Worker', async () => {
  vi.stubGlobal('Worker', TestWorker)
  const { invoke, record } = savedModel()
  const progress = vi.fn()
  const hearing = new LocalHearing()
  await hearing.loadSaved(invoke, progress)
  expect(hearing.ready).toBe(true)
  expect(progress).toHaveBeenCalledWith(100)
  expect(invoke).toHaveBeenLastCalledWith({ type: 'hearing-read', id: record.id, offset: 0 })
  hearing.stop()
  record.sha256 = '0'.repeat(64)
  await expect(hearing.loadSaved(invoke, progress)).rejects.toThrow('校验失败')
  expect(TestWorker.instances).toHaveLength(1)
  expect(hearing.ready).toBe(false)
})

it('stops reading saved chunks after cancellation and never resurrects a Worker', async () => {
  vi.stubGlobal('Worker', TestWorker)
  const { record, bytes } = savedModel()
  let finish!: (reply: SenseReply) => void
  const invoke = vi.fn(async (request: SenseRequest): Promise<SenseReply> => request.type === 'hearing-status' ? { ok: true, hearingModel: record } : new Promise((resolve) => { finish = resolve }))
  const hearing = new LocalHearing()
  const loading = hearing.loadSaved(invoke, vi.fn())
  const rejected = expect(loading).rejects.toThrow('取消')
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
  hearing.stop()
  finish({ ok: true, chunk: bytes.toString('base64') })
  await rejected
  expect(TestWorker.instances).toHaveLength(0)
  expect(hearing.ready).toBe(false)
})
