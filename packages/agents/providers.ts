import type { CatalogRow } from './codex-catalog'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexCatalog, rejectsWebSearch } from './codex-catalog'
import { loaderEnv } from './deeplink'
import presets from './presets.json'

const require = createRequire(import.meta.url)

/** Apps whose provider Anna can set. Presets come from cc-switch (see presets.json `source`). */
export type ProviderApp = 'claude' | 'codex' | 'gemini'
export interface Preset {
  name: string
  website?: string
  apiKeyUrl?: string
  official: boolean
  category: string
  /** claude / gemini: connection env without the key. */
  env?: Record<string, string>
  /** claude: which env var carries the key. */
  keyField?: string
  /** codex */
  baseUrl?: string
  model?: string
  wireApi?: string
  /** Other addresses of the same service, for the speed test. */
  endpoints?: string[]
  /** codex: `model_reasoning_effort`. */
  reasoningEffort?: string
  /** codex: the preset's model rows, for the model catalog. */
  models?: CatalogRow[]
}

/** A provider instance: a preset plus the user's key (and optional model override). */
export interface ProviderChoice { preset: Preset, key?: string, model?: string }
/** `files`: absolute path → content, written (0600) before the agent starts. */
export interface Launch { env: Record<string, string>, args: string[], files?: Record<string, string> }

const catalog = presets as unknown as Record<ProviderApp, Preset[]> & { source: { repo: string, commit: string, license: string } }

export function presetsFor(app: ProviderApp): Preset[] { return catalog[app] }
export function findPreset(app: ProviderApp, name: string) { return catalog[app].find(preset => preset.name === name) }
export const presetSource = catalog.source

/** Whether a preset means "use the CLI's own login" (nothing to inject). */
export function usesOwnLogin(app: ProviderApp, preset: Preset) {
  return app === 'codex' ? !preset.baseUrl : Object.keys(preset.env ?? {}).length === 0
}

const toml = (value: string) => JSON.stringify(value)

/**
 * The env vars a provider may set, wherever it came from (a preset, a hand-written one, a link, an imported file):
 * plain names and single-line values only, and never one that changes how processes load code.
 */
export function providerEnv(preset: Preset): Record<string, string> {
  return Object.fromEntries(Object.entries(preset.env ?? {}).filter(([name, value]) => /^[A-Z_]\w*$/i.test(name) && !loaderEnv.test(name) && typeof value === 'string' && !/[\r\n\0]/.test(value)))
}

/** Claude Code reads the key from one of its own two variables, never from a name the provider data chose. */
export const keyFieldOf = (preset: Preset) => preset.keyField === 'ANTHROPIC_API_KEY' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN'

/**
 * How to start an agent with this provider for one run: env vars and CLI arguments only, never a config file.
 * Keys only ever travel in env vars, so they do not show up in process listings.
 */
export function providerLaunch(app: ProviderApp, choice: ProviderChoice): Launch {
  const { preset, key, model } = choice
  if (usesOwnLogin(app, preset))
    return { env: {}, args: [] }
  if (app === 'claude') {
    const env = providerEnv(preset)
    if (model)
      env.ANTHROPIC_MODEL = model
    if (key)
      env[keyFieldOf(preset)] = key
    return { env, args: [] }
  }
  if (app === 'codex') {
    const args = [
      'model_provider="anna"',
      `model_providers.anna.name=${toml(preset.name)}`,
      `model_providers.anna.base_url=${toml(preset.baseUrl!)}`,
      `model_providers.anna.wire_api=${toml(preset.wireApi ?? 'responses')}`,
      'model_providers.anna.env_key="ANNA_PROVIDER_KEY"',
      ...(model ?? preset.model ? [`model=${toml((model ?? preset.model)!)}`] : []),
      ...(preset.reasoningEffort ? [`model_reasoning_effort=${toml(preset.reasoningEffort)}`] : []),
    ]
    // The model catalog, written once per distinct content to a temp file Codex reads at startup.
    const catalog = codexCatalog(preset, model)
    const files: Record<string, string> = {}
    if (catalog) {
      const text = `${JSON.stringify(catalog, null, 2)}\n`
      const path = join(tmpdir(), 'anna-codex-catalogs', `${createHash('sha256').update(text).digest('hex').slice(0, 16)}.json`)
      files[path] = text
      args.push(`model_catalog_json=${toml(path)}`)
    }
    if (rejectsWebSearch(preset.baseUrl!, model ?? preset.model))
      args.push('web_search="disabled"')
    return { env: key ? { ANNA_PROVIDER_KEY: key } : {}, args: args.flatMap(value => ['-c', value]), files }
  }
  const env = providerEnv(preset)
  if (model)
    env.GEMINI_MODEL = model
  if (key)
    env.GEMINI_API_KEY = key
  return { env, args: [] }
}

export interface ImportedProvider { app: ProviderApp, name: string, current: boolean, key?: string, preset: Preset }

function tomlField(text: string, key: string) {
  return new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(text)?.[1]
}

/** Read an existing cc-switch database (read-only) so users can bring their providers over. */
export function importCcSwitch(path: string): ImportedProvider[] {
  // node:sqlite ships with Node 22+ (and Electron's Node); imported lazily so the renderer bundle never sees it.

  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const rows = db.prepare(`SELECT app_type, name, settings_config, website_url, category, is_current FROM providers WHERE app_type IN ('claude', 'codex', 'gemini') ORDER BY app_type, rowid`).all() as { app_type: ProviderApp, name: string, settings_config: string, website_url: string | null, category: string | null, is_current: number }[]
    return rows.flatMap((row): ImportedProvider[] => {
      let config: { env?: Record<string, string>, auth?: Record<string, string>, config?: string }
      try { config = JSON.parse(row.settings_config) }
      catch { return [] }
      const base = { official: false, category: row.category ?? 'third_party', website: row.website_url ?? undefined }
      if (row.app_type === 'codex') {
        const toml = config.config ?? ''
        return [{ app: 'codex', name: row.name, current: Boolean(row.is_current), key: config.auth?.OPENAI_API_KEY || undefined, preset: { name: row.name, ...base, baseUrl: tomlField(toml, 'base_url'), model: tomlField(toml, 'model'), wireApi: tomlField(toml, 'wire_api') ?? 'responses' } }]
      }
      const env = config.env ?? {}
      const keyField = row.app_type === 'claude' ? (env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN') : 'GEMINI_API_KEY'
      const connection = Object.fromEntries(Object.entries(env).filter(([key, value]) => key !== keyField && !/(?:KEY|TOKEN)$/.test(key) && typeof value === 'string' && value))
      return [{ app: row.app_type, name: row.name, current: Boolean(row.is_current), key: env[keyField] || undefined, preset: { name: row.name, ...base, env: connection, ...(row.app_type === 'claude' ? { keyField } : {}) } }]
    })
  }
  finally { db.close() }
}
