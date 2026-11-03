import type { FileHandle } from 'node:fs/promises'
import type { HearingModel, HearingRequest, SenseReply } from './contracts'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hearingMetadata } from './hearing'

const chunkSize = 1024 * 1024

/** Only Main-selected files enter this store; no paths are accepted from the renderer. */
export class HearingModelStore {
  private pending?: { id: string, controller: AbortController }
  private removing = false
  constructor(private root: string) {}
  dispose() { this.pending?.controller.abort() }
  cancel(id: string) {
    if (this.pending?.id === id)
      this.pending.controller.abort()
  }

  private async current(): Promise<HearingModel | undefined> {
    let text: string
    try { text = await readFile(join(this.root, 'current.json'), 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return
      throw error
    }
    const saved = JSON.parse(text) as HearingModel
    if (!/^[a-f0-9-]{36}$/.test(saved.id) || !/^[a-f0-9]{64}$/.test(saved.sha256))
      throw new Error('Invalid model record')
    const info = await stat(join(this.root, saved.id, 'model.data'))
    if (!info.isFile() || info.size !== saved.size)
      throw new Error('Model size changed')
    return { ...saved, metadata: hearingMetadata(saved.metadata, info.size) }
  }

  async execute(request: Exclude<HearingRequest, { type: 'hearing-import' }>): Promise<SenseReply> {
    try {
      if (request.type === 'hearing-remove') {
        if (this.pending || this.removing)
          return { ok: false, error: '模型正在导入或删除，请先等待或取消' }
        this.removing = true
        try {
          // This directory contains only Anna's model copies, including abandoned crash imports.
          await rm(this.root, { recursive: true, force: true })
          await mkdir(this.root, { recursive: true, mode: 0o700 })
          return { ok: true }
        }
        finally { this.removing = false }
      }
      const model = await this.current()
      if (request.type === 'hearing-status')
        return { ok: true, hearingModel: model }
      if (!model || request.id !== model.id || !Number.isSafeInteger(request.offset) || request.offset < 0 || request.offset >= model.size)
        return { ok: false, error: '本地模型已改变或读取位置无效，请重新加载' }
      const file = await open(join(this.root, model.id, 'model.data'), 'r')
      try {
        const bytes = Buffer.alloc(Math.min(chunkSize, model.size - request.offset))
        const { bytesRead } = await file.read(bytes, 0, bytes.length, request.offset)
        if (bytesRead !== bytes.length)
          throw new Error('Incomplete model')
        return { ok: true, chunk: bytes.toString('base64') }
      }
      finally { await file.close() }
    }
    catch { return { ok: false, error: '本地模型记录不可用，请重新导入模型包' } }
  }

  async importFiles(id: string, metadataPath: string, modelPath: string): Promise<SenseReply> {
    if (this.pending || this.removing || !id || id.length > 100)
      return { ok: false, error: '模型正在导入，请先等待或取消' }
    const controller = new AbortController()
    this.pending = { id, controller }
    const generation = randomUUID()
    const directory = join(this.root, generation)
    const pointer = join(this.root, `${generation}.json`)
    let committed = false
    const handles: FileHandle[] = []
    try {
      const old = await this.current().catch(() => undefined)
      const metaFile = await open(metadataPath, 'r')
      handles.push(metaFile)
      const input = await open(modelPath, 'r')
      handles.push(input)
      const [metaInfo, modelInfo] = await Promise.all([metaFile.stat(), input.stat()])
      if (!metaInfo.isFile() || metaInfo.size > 65536 || !modelInfo.isFile())
        throw new Error('Invalid model files')
      const metadata = hearingMetadata(JSON.parse(await metaFile.readFile('utf8')), modelInfo.size)
      controller.signal.throwIfAborted()
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const output = await open(join(directory, 'model.data'), 'wx', 0o600)
      const hash = createHash('sha256')
      try {
        const buffer = Buffer.alloc(chunkSize)
        let offset = 0
        while (offset < modelInfo.size) {
          controller.signal.throwIfAborted()
          const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, modelInfo.size - offset), offset)
          if (!bytesRead)
            throw new Error('Model changed during import')
          const chunk = buffer.subarray(0, bytesRead)
          hash.update(chunk)
          await output.writeFile(chunk)
          offset += bytesRead
        }
        await output.sync()
      }
      finally { await output.close() }
      controller.signal.throwIfAborted()
      const model: HearingModel = { id: generation, sha256: hash.digest('hex'), size: modelInfo.size, metadata }
      await writeFile(pointer, JSON.stringify(model), { mode: 0o600 })
      controller.signal.throwIfAborted()
      await rename(pointer, join(this.root, 'current.json'))
      committed = true
      if (old)
        await rm(join(this.root, old.id), { recursive: true, force: true }).catch(() => {})
      return { ok: true, hearingModel: model }
    }
    catch { return { ok: false, error: controller.signal.aborted ? '模型导入已取消，原模型保留' : '模型导入失败，请检查对应的元数据、模型数据及可用磁盘空间' } }
    finally {
      await Promise.allSettled(handles.map(file => file.close()))
      this.pending = undefined
      await rm(pointer, { force: true }).catch(() => {})
      if (!committed)
        await rm(directory, { recursive: true, force: true }).catch(() => {})
    }
  }
}
