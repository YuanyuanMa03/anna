import type { ProviderChoice } from './providers'
import { createHash } from 'node:crypto'
import { aggregateId } from '../routing/server'
import { codexCatalog } from './codex-catalog'
import { upstreamOf } from './providers'
import { claudeAliases } from './takeover'

/**
 * Aggregation (global routing): other providers' models in the agent's own model list, each under an id that tells
 * Anna's routing which provider to send it to. Built after cc-switch's Stack mode (MIT).
 */

/** A provider listed in the model list, with the key its models are published under. */
export interface Listed { key: string, choice: ProviderChoice }

const keyLength = 24

/**
 * A new key for a provider: its name in lowercase letters, digits and single dashes (so never `--` or `/`, the ids'
 * separators), or `p` and a hash for a name with none of those; `-2`, `-3`… when taken. Taken includes keys of
 * providers since deleted, so an id an agent remembers never reaches another provider.
 */
export function modelKeyFor(name: string, taken: Iterable<string>) {
  const used = new Set(taken)
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, keyLength).replace(/-+$/, '')
  const base = slug || `p${createHash('sha256').update(name).digest('hex').slice(0, 6)}`
  let key = base
  for (let index = 2; used.has(key); index++) key = `${base}-${index}`
  return key
}

/** One row of Claude Code's `/model` picker (`modelPicker.options` in settings.json). */
export interface PickerRow { model: string, label: string, description: string, behavesAs: string }

const oneM = /\s*\[1m\]\s*$/i

/**
 * Claude Code's picker rows for the listed providers: each one's models (`ANTHROPIC_MODEL` and the tiers,
 * deduplicated, `[1M]` kept when any setting of the model has it). `behavesAs` gives a model Claude Code doesn't know
 * a known one's handling rather than a guessed context window.
 */
export function claudePickerRows(listed: Listed[]): PickerRow[] {
  return listed.flatMap(({ key, choice }) => {
    const { models = {} } = upstreamOf('claude', choice)
    const found = new Map<string, boolean>()
    for (const name of [models.default, models.opus, models.sonnet, models.haiku, models.fable]) {
      const model = name?.replace(oneM, '').trim()
      if (model)
        found.set(model, Boolean(found.get(model)) || oneM.test(name!))
    }
    const provider = choice.preset.name
    return [...found].map(([model, large]) => ({ model: `${aggregateId('claude', key, model)}${large ? '[1M]' : ''}`, label: `${model}（${provider}）`, description: `经 Anna 的路由发给 ${provider}`, behavesAs: claudeAliases.sonnet }))
  })
}

interface Catalog { models: Record<string, unknown>[] }

/**
 * Codex's model catalog with the listed providers: the provider in use's rows as they are, then each listed
 * provider's rows from its own catalog (its tool profile included) under the prefixed slug, ordered after them.
 */
export function codexAggregateCatalog(inUse: Catalog | undefined, listed: Listed[]): Catalog | undefined {
  const models = [...(inUse?.models ?? [])]
  let priority = Math.max(0, ...models.map(entry => typeof entry.priority === 'number' ? entry.priority : 0))
  for (const { key, choice } of listed) {
    for (const entry of codexCatalog(choice.preset, choice.model)?.models ?? []) {
      const slug = String(entry.slug)
      const name = typeof entry.display_name === 'string' ? entry.display_name : slug
      models.push({ ...entry, slug: aggregateId('codex', key, slug), display_name: `${name}（${choice.preset.name}）`, description: `${slug} · 经 Anna 的路由发给 ${choice.preset.name}`, priority: ++priority })
    }
  }
  return models.length ? { models } : undefined
}
