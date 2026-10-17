import { createRequire } from 'node:module'
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
}

/** A provider instance: a preset plus the user's key (and optional model override). */
export interface ProviderChoice { preset: Preset, key?: string, model?: string }
export interface Launch { env: Record<string, string>, args: string[] }

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
 * How to start an agent with this provider for one run: env vars and CLI arguments only, never a config file.
 * Keys only ever travel in env vars, so they do not show up in process listings.
 */
export function providerLaunch(app: ProviderApp, choice: ProviderChoice): Launch {
  const { preset, key, model } = choice
  if (usesOwnLogin(app, preset))
    return { env: {}, args: [] }
  if (app === 'claude') {
    const env = { ...preset.env }
    if (model)
      env.ANTHROPIC_MODEL = model
    if (key)
      env[preset.keyField ?? 'ANTHROPIC_AUTH_TOKEN'] = key
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
    ].flatMap(value => ['-c', value])
    return { env: key ? { ANNA_PROVIDER_KEY: key } : {}, args }
  }
  const env = { ...preset.env }
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
