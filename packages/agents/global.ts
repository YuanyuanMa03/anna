import type { ProviderApp, ProviderChoice } from './providers'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { usesOwnLogin } from './providers'

/**
 * Global provider switching, following cc-switch's ownership rule: Anna owns only the connection fields of a client's
 * config and never touches the rest. Files that cannot be parsed safely are left alone.
 * `files` maps a file name in the app's config directory to its current text (undefined when missing).
 */
export interface GlobalPlan { writes: Record<string, string> }

/** Claude Code settings.json `env` keys that belong to the connection (cc-switch live/floor.rs). */
function claudeConnectionKey(key: string) {
  return key.startsWith('ANTHROPIC_') || key.startsWith('AWS_') || key.startsWith('VERTEX_REGION_') || key.startsWith('CLAUDE_CODE_USE_')
    || ['CLAUDE_CODE_SUBAGENT_MODEL', 'CLOUD_ML_REGION', 'GOOGLE_APPLICATION_CREDENTIALS', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_SCOPES', 'CLAUDE_CODE_API_KEY_HELPER_TTL_MS'].includes(key)
    || (key.startsWith('CLAUDE_CODE_SKIP_') && key.endsWith('_AUTH'))
}
/** Gemini CLI .env keys that belong to the connection. */
function geminiConnectionKey(key: string) {
  return key.startsWith('GOOGLE_') || ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_API_KEY_AUTH_MECHANISM', 'GEMINI_CLI_CUSTOM_HEADERS', 'GEMINI_DEFAULT_AUTH_TYPE', 'GEMINI_CLI_USE_COMPUTE_ADC', 'CODE_ASSIST_ENDPOINT', 'CODE_ASSIST_API_VERSION'].includes(key)
}
/** Codex config.toml top-level keys that belong to the connection. */
const codexTopKeys = ['model_provider', 'openai_base_url', 'model', 'model_reasoning_effort', 'experimental_bearer_token', 'base_url', 'wire_api']

function parseJson(name: string, text: string | undefined): Record<string, any> {
  if (text === undefined || !text.trim())
    return {}
  // Comments or trailing commas mean JSONC: rewriting would drop them, so refuse like cc-switch does.
  if (/^\s*\/\/|\/\*/m.test(text))
    throw new Error(`${name} 含有注释，无法安全解析，未做修改`)
  try {
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('not an object')
    return value
  }
  catch { throw new Error(`${name} 无法安全解析，未做修改`) }
}
function indentOf(text: string | undefined) {
  return /\n([ \t]+)"/.exec(text ?? '')?.[1] ?? '  '
}
const json = (value: unknown, like?: string) => `${JSON.stringify(value, null, indentOf(like))}\n`

function claudePlan(files: Record<string, string | undefined>, choice: ProviderChoice): GlobalPlan {
  const original = files['settings.json']
  const settings = parseJson('settings.json', original)
  const env: Record<string, string> = Object.fromEntries(Object.entries(settings.env ?? {}).filter(([key]) => !claudeConnectionKey(key))) as Record<string, string>
  if (!usesOwnLogin('claude', choice.preset)) {
    Object.assign(env, choice.preset.env)
    if (choice.model)
      env.ANTHROPIC_MODEL = choice.model
    if (choice.key)
      env[choice.preset.keyField ?? 'ANTHROPIC_AUTH_TOKEN'] = choice.key
  }
  return { writes: { 'settings.json': json({ ...settings, env }, original) } }
}

const tomlString = (value: string) => JSON.stringify(value)

/** Edit config.toml line by line: top-level connection keys and the [model_providers.custom] table only. */
function codexPlan(files: Record<string, string | undefined>, choice: ProviderChoice): GlobalPlan {
  const original = files['config.toml'] ?? ''
  if (/^\s*model_providers\s*=|^\s*model_providers\.custom\./m.test(original))
    throw new Error('config.toml 用内联或点号写法定义了 model_providers，无法安全解析，未做修改')
  const lines = original.split('\n')
  const firstTable = lines.findIndex(line => /^\s*\[/.test(line))
  const top = (firstTable === -1 ? lines : lines.slice(0, firstTable)).filter(line => !codexTopKeys.some(key => new RegExp(`^\\s*${key}\\s*=`).test(line)))
  let rest = firstTable === -1 ? [] : lines.slice(firstTable)
  // Drop the existing [model_providers.custom] table (header to next header).
  const start = rest.findIndex(line => /^\s*\[model_providers\.custom\]\s*$/.test(line))
  if (start !== -1) {
    const end = rest.findIndex((line, index) => index > start && /^\s*\[/.test(line))
    rest = [...rest.slice(0, start), ...(end === -1 ? [] : rest.slice(end))]
  }
  const writes: Record<string, string> = {}
  if (usesOwnLogin('codex', choice.preset)) {
    writes['config.toml'] = [...top, ...rest].join('\n')
    return { writes }
  }
  const model = choice.model ?? choice.preset.model
  const head = [`model_provider = "custom"`, ...(model ? [`model = ${tomlString(model)}`] : [])]
  const table = ['[model_providers.custom]', `name = ${tomlString(choice.preset.name)}`, `base_url = ${tomlString(choice.preset.baseUrl!)}`, `wire_api = ${tomlString(choice.preset.wireApi ?? 'responses')}`, 'requires_openai_auth = true']
  const trimmedTop = top.join('\n').replace(/\n+$/, '')
  const trimmedRest = rest.join('\n').replace(/^\n+|\n+$/g, '')
  writes['config.toml'] = `${[trimmedTop, head.join('\n')].filter(Boolean).join('\n')}\n\n${trimmedRest ? `${trimmedRest}\n\n` : ''}${table.join('\n')}\n`
  if (choice.key)
    writes['auth.json'] = json({ OPENAI_API_KEY: choice.key }, files['auth.json'])
  return { writes }
}

function geminiPlan(files: Record<string, string | undefined>, choice: ProviderChoice): GlobalPlan {
  const kept = (files['.env'] ?? '').split('\n').filter(line => !geminiConnectionKey(/^\s*(?:export\s+)?([\w.-]+)\s*=/.exec(line)?.[1] ?? '')).join('\n').replace(/\n+$/, '')
  const settings = parseJson('settings.json', files['settings.json'])
  const writes: Record<string, string> = {}
  if (usesOwnLogin('gemini', choice.preset)) {
    writes['.env'] = kept ? `${kept}\n` : ''
    if (settings.security?.auth)
      delete settings.security.auth.selectedType
    writes['settings.json'] = json(settings, files['settings.json'])
    return { writes }
  }
  const env = { ...choice.preset.env, ...(choice.model ? { GEMINI_MODEL: choice.model } : {}), ...(choice.key ? { GEMINI_API_KEY: choice.key } : {}) }
  writes['.env'] = `${[kept, ...Object.entries(env).map(([key, value]) => `${key}=${value}`)].filter(Boolean).join('\n')}\n`
  writes['settings.json'] = json({ ...settings, security: { ...settings.security, auth: { ...settings.security?.auth, selectedType: 'gemini-api-key' } } }, files['settings.json'])
  return { writes }
}

export function globalPlan(app: ProviderApp, files: Record<string, string | undefined>, choice: ProviderChoice): GlobalPlan {
  if (app === 'claude')
    return claudePlan(files, choice)
  if (app === 'codex')
    return codexPlan(files, choice)
  return geminiPlan(files, choice)
}

/** The files each app's global switch may touch, relative to its config directory. */
export const globalFiles: Record<ProviderApp, string[]> = { claude: ['settings.json'], codex: ['config.toml', 'auth.json'], gemini: ['.env', 'settings.json'] }

interface SwitchState { switched: boolean, provider?: string, at?: string, originals: Record<string, boolean> }

/**
 * Applies global plans to the real config files: the first write backs up each original (or records that it did not
 * exist), writes are atomic and re-read to verify, and `restore` puts every original back byte-for-byte.
 * Writes are serialized per process.
 */
export class GlobalSwitcher {
  private chain: Promise<unknown> = Promise.resolve()
  private states: Partial<Record<ProviderApp, SwitchState>> = {}
  constructor(private backupRoot: string, private dirs: Record<ProviderApp, string>) {}

  private stateFile(app: ProviderApp) { return join(this.backupRoot, app, 'state.json') }
  private load(app: ProviderApp): SwitchState {
    if (!this.states[app]) {
      try { this.states[app] = JSON.parse(readFileSync(this.stateFile(app), 'utf8')) as SwitchState }
      catch { this.states[app] = { switched: false, originals: {} } }
    }
    return this.states[app]!
  }

  private async save(app: ProviderApp, state: SwitchState) {
    this.states[app] = state
    await mkdir(join(this.backupRoot, app), { recursive: true, mode: 0o700 })
    await writeFile(this.stateFile(app), JSON.stringify(state), { mode: 0o600 })
  }

  status(app: ProviderApp) {
    const { switched, provider, at } = this.load(app)
    return { switched, provider, at }
  }

  private serialize<T>(work: () => Promise<T>) {
    const run = this.chain.then(work, work)
    this.chain = run.catch(() => {})
    return run
  }

  apply(app: ProviderApp, choice: ProviderChoice) {
    return this.serialize(async () => {
      const dir = this.dirs[app]
      const files: Record<string, string | undefined> = {}
      for (const name of globalFiles[app]) files[name] = existsSync(join(dir, name)) ? await readFile(join(dir, name), 'utf8') : undefined
      const { writes } = globalPlan(app, files, choice)
      const state = this.load(app)
      await mkdir(join(this.backupRoot, app), { recursive: true, mode: 0o700 })
      for (const name of Object.keys(writes)) {
        if (name in state.originals)
          continue
        state.originals[name] = files[name] !== undefined
        if (files[name] !== undefined)
          await writeFile(join(this.backupRoot, app, `${name}.orig`), files[name]!, { mode: 0o600 })
      }
      await this.save(app, state)
      await mkdir(dir, { recursive: true })
      for (const [name, text] of Object.entries(writes)) {
        const target = join(dir, name)
        await writeFile(`${target}.anna-tmp`, text, { mode: 0o600 })
        await rename(`${target}.anna-tmp`, target)
        if (await readFile(target, 'utf8') !== text)
          throw new Error(`${name} 写入后内容不一致，已停止`)
      }
      await this.save(app, { ...state, switched: true, provider: choice.preset.name, at: new Date().toISOString() })
    })
  }

  restore(app: ProviderApp) {
    return this.serialize(async () => {
      const state = this.load(app)
      const dir = this.dirs[app]
      for (const [name, existed] of Object.entries(state.originals)) {
        const target = join(dir, name)
        if (existed)
          await writeFile(target, await readFile(join(this.backupRoot, app, `${name}.orig`)))
        else
          await rm(target, { force: true })
      }
      await rm(join(this.backupRoot, app), { recursive: true, force: true })
      this.states[app] = { switched: false, originals: {} }
    })
  }
}
