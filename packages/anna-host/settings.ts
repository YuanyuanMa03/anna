import type { CharacterId } from '../character/manifest'
import type { ModelSettings, Settings, WorkspaceSettings } from '../shared/contracts'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as v from 'valibot'
import { characters } from '../character/manifest'
import { emptyRules } from '../permissions/rules'

const modelSchema = v.object({ provider: v.picklist(['deepseek-official', 'custom']), model: v.pipe(v.string(), v.minLength(1), v.maxLength(200), v.regex(/^[\w./:@+-]+$/)), baseURL: v.pipe(v.string(), v.url()), api: v.picklist(['anthropic-messages', 'openai-completions', 'openai-responses']) })
const ruleList = v.optional(v.array(v.pipe(v.string(), v.maxLength(500))), [])
const workspaceSchema = v.object({ trusted: v.boolean(), mode: v.picklist(['plan', 'ask', 'edit', 'auto']), rules: v.optional(v.object({ allow: ruleList, ask: ruleList, deny: ruleList }), () => emptyRules()) })
const settingsSchema = v.object({
  version: v.literal(2),
  kernel: v.optional(v.picklist(['pi', 'claude-code', 'codex']), 'pi'),
  characterId: v.picklist(characters.map(character => character.id) as [CharacterId, ...CharacterId[]]),
  statusEnabled: v.boolean(),
  memoryEnabled: v.optional(v.boolean(), true),
  reviewDelegations: v.optional(v.boolean(), true),
  model: modelSchema,
  sessionFile: v.optional(v.string()),
  modelVerified: v.optional(v.boolean()),
  workspace: v.optional(v.string()),
  workspaces: v.optional(v.record(v.string(), workspaceSchema), {}),
  agents: v.optional(v.record(v.string(), v.object({ provider: v.optional(v.string()) }))),
  providers: v.optional(v.array(v.object({ app: v.picklist(['claude', 'codex', 'gemini']), name: v.string(), preset: v.looseObject({ name: v.string(), official: v.boolean(), category: v.string() }) }))),
})

/** Validate the endpoint before a credential crosses the host network boundary. */
export function validateModel(value: unknown): ModelSettings {
  const model = v.parse(modelSchema, value)
  const url = new URL(model.baseURL)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('API 端点必须是无凭据和查询参数的 HTTPS 地址')
  return model
}

/**
 * Settings migrations. Each step takes the previous on-disk shape and returns the next; never drop user intent silently.
 * v1 (0.3.0 and earlier): workEnabled boolean, single workspace, sessionId (DSH) or sessionFile.
 */
export function migrate(raw: Record<string, unknown>): Settings {
  let value = { ...raw }
  if (value.version === undefined) {
    const workspaces: Record<string, WorkspaceSettings> = {}
    if (typeof value.workspace === 'string')
      workspaces[value.workspace] = { trusted: true, mode: value.workEnabled === false ? 'plan' : 'edit', rules: emptyRules() }
    const { workEnabled: _work, sessionId: _session, ...rest } = value
    value = { ...rest, version: 2, workspaces }
  }
  // Hiyori left the cast; Haru took over as Anna.
  if (value.characterId === 'hiyori')
    value.characterId = 'haru'
  return v.parse(settingsSchema, value) as Settings
}

export const defaultSettings = (): Settings => ({ version: 2, kernel: 'pi', characterId: 'haru', statusEnabled: true, memoryEnabled: true, reviewDelegations: true, workspaces: {}, model: { provider: 'deepseek-official', model: 'deepseek-flash', baseURL: 'https://api.deepseek.com', api: 'openai-completions' } })

/** The host is the sole writer. Atomic replacement prevents truncated settings after a crash. */
export class SettingsStore {
  value: Settings = defaultSettings()
  migratedFrom?: number
  private writing = Promise.resolve()
  constructor(readonly directory: string) {}
  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    try {
      const raw = JSON.parse(await readFile(join(this.directory, 'settings.json'), 'utf8')) as Record<string, unknown>
      this.value = migrate(raw)
      if (raw.version !== this.value.version) {
        this.migratedFrom = typeof raw.version === 'number' ? raw.version : 1
        await this.save()
      }
    }
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
