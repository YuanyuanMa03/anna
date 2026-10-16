import type { ModelSettings, Settings } from '../shared/contracts'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as v from 'valibot'

const modelSchema = v.object({ provider: v.picklist(['deepseek-official', 'custom']), model: v.pipe(v.string(), v.minLength(1), v.maxLength(200), v.regex(/^[\w./:@+-]+$/)), baseURL: v.pipe(v.string(), v.url()), api: v.picklist(['anthropic-messages', 'openai-completions', 'openai-responses']) })
const settingsSchema = v.object({ characterId: v.picklist(['hiyori', 'haru', 'mark']), statusEnabled: v.boolean(), model: modelSchema, sessionId: v.optional(v.string()) })
/** Validate the endpoint before a credential crosses the host network boundary. */
export function validateModel(value: unknown): ModelSettings {
  const model = v.parse(modelSchema, value)
  const url = new URL(model.baseURL)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('API 端点必须是无凭据和查询参数的 HTTPS 地址')
  return model
}
/** The host is the sole writer. Atomic replacement prevents truncated settings after a crash. */
export class SettingsStore {
  value: Settings = { characterId: 'hiyori', statusEnabled: true, model: { provider: 'deepseek-official', model: 'deepseek-v4-flash', baseURL: 'https://api.deepseek.com/anthropic', api: 'anthropic-messages' } }
  private writing = Promise.resolve()
  constructor(readonly directory: string) {}
  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    try { this.value = v.parse(settingsSchema, JSON.parse(await readFile(join(this.directory, 'settings.json'), 'utf8'))) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
  }

  save() {
    const settings = structuredClone(this.value)
    const write = async () => {
      const path = join(this.directory, 'settings.json')
      await writeFile(`${path}.tmp`, JSON.stringify(settings, null, 2), { mode: 0o600 })
      await rename(`${path}.tmp`, path)
      await this.character()
    }
    const task = this.writing.then(write, write)
    this.writing = task
    return task
  }

  async character() {
    const path = join(this.directory, 'character.json')
    await writeFile(`${path}.tmp`, JSON.stringify({ characterId: this.value.characterId }), { mode: 0o600 })
    await rename(`${path}.tmp`, path)
  }
}
