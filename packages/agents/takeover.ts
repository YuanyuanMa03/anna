import type { ClaudeModels } from '../routing/server'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { claudeConnectionKey, codexCatalogFile, codexCompose, codexSections, json, parseJson, tomlString, writeConfig } from './global'

/**
 * Global routing: an agent's own config points at Anna's routing, so the CLI the user runs in a terminal goes through
 * the provider (and backups) chosen in Anna. Only the connection fields are taken over, and only they are put back
 * when Anna lets go (on quit, or when switched off), so anything else changed meanwhile — by the user, or by the CLI
 * itself — stays. Built after cc-switch's proxy takeover (MIT).
 */

export interface RoutingTarget {
  /** The route's base URL on the fixed port (`…/claude`, `…/codex/v1`). */
  url: string
  token: string
}

/**
 * The tier names Claude Code sees (cc-switch's proxy aliases, kept current: Claude Code picks thinking settings by
 * them). Anna's routing maps each back to the provider's model for that tier.
 */
export const claudeAliases = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5', opus: 'claude-opus-5', fable: 'claude-fable-5' } as const
const oneM = /\s*\[1m\]\s*$/i

/**
 * What the takeover sets aside in settings.json: the connection fields in `env`, and top-level settings that would
 * supply another key (`apiKeyHelper`, whose key Claude Code would send instead of the route's token).
 */
export interface ClaudeOriginals { env: Record<string, string>, top?: Record<string, unknown> }
const claudeTopKeys = ['apiKeyHelper']

/** settings.json with Claude Code pointed at the route; `originals` are the fields it replaced. */
export function claudeTakeover(text: string | undefined, target: RoutingTarget & { models: ClaudeModels }, originals?: ClaudeOriginals) {
  const parsed = parseJson('settings.json', text)
  const env: Record<string, unknown> = parsed.env && typeof parsed.env === 'object' ? parsed.env : {}
  const kept = Object.fromEntries(Object.entries(env).filter(([key]) => !claudeConnectionKey(key)))
  const top = Object.fromEntries(claudeTopKeys.filter(key => key in parsed).map(key => [key, parsed[key]]))
  const settings = Object.fromEntries(Object.entries(parsed).filter(([key]) => !claudeTopKeys.includes(key)))
  const captured: ClaudeOriginals = originals ?? { env: Object.fromEntries(Object.entries(env).filter(([key, value]) => claudeConnectionKey(key) && typeof value === 'string')) as Record<string, string>, ...(Object.keys(top).length ? { top } : {}) }
  const ours: Record<string, string> = { ANTHROPIC_BASE_URL: target.url, ANTHROPIC_AUTH_TOKEN: target.token }
  const { models } = target
  const tiers: [keyof typeof claudeAliases, string | undefined][] = [['haiku', models.haiku ?? models.default], ['sonnet', models.sonnet ?? models.default], ['opus', models.opus ?? models.default], ['fable', models.fable]]
  for (const [tier, upstream] of tiers) {
    if (!upstream)
      continue
    const name = tier.toUpperCase()
    // A 1M model keeps the marker, so Claude Code counts the larger window (haiku's alias already implies it).
    ours[`ANTHROPIC_DEFAULT_${name}_MODEL`] = `${claudeAliases[tier]}${tier !== 'haiku' && oneM.test(upstream) ? '[1M]' : ''}`
    ours[`ANTHROPIC_DEFAULT_${name}_MODEL_NAME`] = upstream.replace(oneM, '')
  }
  return { text: json({ ...settings, env: { ...kept, ...ours } }, text), originals: captured }
}

/** settings.json with the fields set aside as they were before the takeover; the rest as it is now. */
export function claudeRelease(text: string | undefined, originals: ClaudeOriginals) {
  const settings = { ...parseJson('settings.json', text), ...originals.top }
  const env: Record<string, unknown> = settings.env && typeof settings.env === 'object' ? settings.env : {}
  const next = { ...Object.fromEntries(Object.entries(env).filter(([key]) => !claudeConnectionKey(key))), ...originals.env }
  if (Object.keys(next).length)
    settings.env = next
  else delete settings.env
  return json(settings, text)
}

export interface CodexOriginals { top: string[], table?: string[] }

/**
 * config.toml with Codex pointed at the route: a [model_providers.custom] table with the route's token as
 * `experimental_bearer_token` (auth.json, and the user's ChatGPT login in it, stay untouched), the provider's model
 * and Anna's model catalog for it.
 */
export function codexTakeover(text: string | undefined, target: RoutingTarget & { model?: string, catalogPath?: string }, originals?: CodexOriginals) {
  const { top, connection, rest, custom } = codexSections(text ?? '')
  const captured = originals ?? { top: connection, ...(custom ? { table: custom } : {}) }
  const head = ['model_provider = "custom"', ...(target.model ? [`model = ${tomlString(target.model)}`] : []), ...(target.catalogPath ? [`model_catalog_json = ${tomlString(target.catalogPath)}`] : [])]
  const table = ['[model_providers.custom]', 'name = "Anna"', `base_url = ${tomlString(target.url)}`, 'wire_api = "responses"', `experimental_bearer_token = ${tomlString(target.token)}`]
  return { text: codexCompose(top, head, rest, table), originals: captured }
}

export function codexRelease(text: string | undefined, originals: CodexOriginals) {
  const { top, rest } = codexSections(text ?? '')
  return codexCompose(top, originals.top, rest, originals.table ?? [])
}

type Target = { app: 'claude', target: RoutingTarget & { models: ClaudeModels } } | { app: 'codex', target: RoutingTarget & { model?: string }, catalog?: string }
/**
 * `original`: the whole file before the takeover (null: there was none), put back as it was when nothing else
 * changed meanwhile (the file is still `written`); otherwise only the connection fields go back.
 */
interface State { active: boolean, originals?: ClaudeOriginals | CodexOriginals, original?: string | null, written?: string, catalog?: string | null }

/**
 * Applies and releases global routing on the real config files. The state (with the replaced fields) is saved before
 * a file is written, so after a crash the next start finds the takeover and either renews or releases it.
 */
export class RoutingTakeover {
  private chain: Promise<unknown> = Promise.resolve()
  constructor(private stateRoot: string, private dirs: { claude: string, codex: string }) {}

  private stateFile(app: 'claude' | 'codex') { return join(this.stateRoot, app, 'routing.json') }
  private async load(app: 'claude' | 'codex'): Promise<State> {
    try { return JSON.parse(await readFile(this.stateFile(app), 'utf8')) as State }
    catch { return { active: false } }
  }

  private async save(app: 'claude' | 'codex', state: State) {
    await mkdir(join(this.stateRoot, app), { recursive: true, mode: 0o700 })
    await writeFile(this.stateFile(app), JSON.stringify(state), { mode: 0o600 })
  }

  private serialize<T>(work: () => Promise<T>) {
    const run = this.chain.then(work, work)
    this.chain = run.catch(() => {})
    return run
  }

  private async read(path: string) { return existsSync(path) ? readFile(path, 'utf8') : undefined }
  private async write(path: string, text: string) {
    await mkdir(join(path, '..'), { recursive: true })
    await writeConfig(path, text)
  }

  /** Whether Anna holds this agent's config (also right after a crash, until the next start sorts it out). */
  async active(app: 'claude' | 'codex') { return (await this.load(app)).active }

  /** Point the agent's config at the route (again); true when a file changed. */
  apply(spec: Target): Promise<boolean> {
    return this.serialize(async () => {
      const dir = this.dirs[spec.app]
      const state = await this.load(spec.app)
      const path = join(dir, spec.app === 'claude' ? 'settings.json' : 'config.toml')
      const catalogPath = join(dir, codexCatalogFile)
      const current = await this.read(path)
      const plan = spec.app === 'claude'
        ? claudeTakeover(current, spec.target, state.active ? state.originals as ClaudeOriginals : undefined)
        : codexTakeover(current, { ...spec.target, ...(spec.catalog ? { catalogPath } : {}) }, state.active ? state.originals as CodexOriginals : undefined)
      // Intent first: after a crash between here and the write, the next start still knows what to put back.
      const next: State = state.active ? { ...state, written: plan.text } : { active: true, originals: plan.originals, original: current ?? null, written: plan.text, ...(spec.app === 'codex' ? { catalog: (await this.read(catalogPath)) ?? null } : {}) }
      await this.save(spec.app, next)
      let changed = false
      if (spec.app === 'codex' && spec.catalog && (await this.read(catalogPath)) !== spec.catalog) {
        await this.write(catalogPath, spec.catalog)
        changed = true
      }
      if (plan.text !== current) {
        await this.write(path, plan.text)
        changed = true
      }
      return changed
    })
  }

  /** Put the connection fields back as they were; nothing to do when Anna doesn't hold the config. */
  release(app: 'claude' | 'codex'): Promise<void> {
    return this.serialize(async () => {
      const state = await this.load(app)
      if (!state.active)
        return
      const dir = this.dirs[app]
      const path = join(dir, app === 'claude' ? 'settings.json' : 'config.toml')
      const current = await this.read(path)
      if (state.original !== undefined && current === state.written) {
        // Untouched since: the file goes back byte for byte (or away, if there was none).
        if (state.original === null)
          await rm(path, { force: true })
        else await this.write(path, state.original)
      }
      else if (app === 'claude') {
        await this.write(path, claudeRelease(current, (state.originals ?? { env: {} }) as ClaudeOriginals))
      }
      else {
        await this.write(path, codexRelease(current, (state.originals ?? { top: [] }) as CodexOriginals))
      }
      if (app === 'codex') {
        const catalogPath = join(dir, codexCatalogFile)
        if (typeof state.catalog === 'string')
          await this.write(catalogPath, state.catalog)
        else await rm(catalogPath, { force: true })
      }
      await this.save(app, { active: false })
    })
  }
}
