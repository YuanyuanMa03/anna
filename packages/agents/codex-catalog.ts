import type { Preset } from './providers'
import classicTemplate from './codex-catalog/classic-tools.json'
import deepseekCatalog from './codex-catalog/deepseek.json'
import nativeTemplate from './codex-catalog/native-responses.json'

/** One model row of a Codex preset, as cc-switch declares it. */
export interface CatalogRow {
  model: string
  displayName?: string
  contextWindow?: number
  inputModalities?: string[]
  reasoningLevels?: string[]
  defaultReasoningLevel?: string
  baseInstructions?: string
  supportsParallelToolCalls?: boolean
}

type Entry = Record<string, unknown>

/** The efforts Codex understands, lowest to highest, with the descriptions Codex's own catalog uses. */
const efforts: [string, string][] = [
  ['none', 'Disable Thinking'],
  ['minimal', 'Minimal reasoning'],
  ['low', 'Fast responses with lighter reasoning'],
  ['medium', 'Balances speed and reasoning depth for everyday tasks'],
  ['high', 'Greater reasoning depth for complex problems'],
  ['xhigh', 'Extra high reasoning depth for complex problems'],
  ['max', 'Maximum reasoning depth for the hardest problems'],
  ['ultra', 'Ultra reasoning depth'],
]

/** Hosts whose native Responses gateway publishes an official Codex catalog, matched on the base URL only. */
const officialCatalogs: [string, Entry[]][] = [['deepseek.com', deepseekCatalog.models as Entry[]]]

/**
 * Native Responses gateways that reject Codex's hosted `web_search` tool (a blacklist, as in cc-switch: an unknown
 * provider keeps Codex's default). Matched by base-URL host and by model brand, so an aggregator serving these models
 * is caught too.
 */
const webSearchRejectHosts = ['xiaomimimo.com', 'longcat.chat', 'minimax.io', 'minimax.cn', 'minimaxi.com', 'stepfun.com', 'stepfun.ai']
const webSearchRejectModels = ['mimo', 'longcat', 'minimax', 'qwen3-coder', 'glm']

function host(url: string) {
  try { return new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase() }
  catch { return '' }
}
const hostMatches = (url: string, domain: string) => host(url) === domain || host(url).endsWith(`.${domain}`)

/** Whether this provider's gateway rejects `web_search`, so Codex must not send it. */
export function rejectsWebSearch(baseUrl: string, model?: string) {
  const brand = (model ?? '').trim().toLowerCase().split('/').at(-1)!
  return webSearchRejectHosts.some(domain => hostMatches(baseUrl, domain)) || (Boolean(brand) && webSearchRejectModels.some(prefix => brand.startsWith(prefix)))
}

/** Declared reasoning levels win; the default stays the template's when still offered, else the highest offered. */
function applyReasoning(entry: Entry, row: CatalogRow) {
  const offered = efforts.filter(([effort]) => row.reasoningLevels?.includes(effort))
  if (!offered.length)
    return
  entry.supported_reasoning_levels = offered.map(([effort, description]) => ({ effort, description }))
  const allowed = offered.map(([effort]) => effort)
  const fallback = typeof entry.default_reasoning_level === 'string' ? entry.default_reasoning_level : undefined
  entry.default_reasoning_level = [row.defaultReasoningLevel, fallback].find(level => level && allowed.includes(level)) ?? allowed.at(-1)
}

/** An entry from the neutral native-Responses template: no freeform apply_patch, edits go through the shell tool. */
function nativeEntry(row: CatalogRow, index: number): Entry {
  const entry: Entry = structuredClone(nativeTemplate)
  const name = row.displayName ?? row.model
  const window = row.contextWindow ?? nativeTemplate.context_window
  Object.assign(entry, { slug: row.model, visibility: 'list', display_name: name, description: name, context_window: window, max_context_window: window, priority: 1000 + index, input_modalities: row.inputModalities?.length ? row.inputModalities : ['text', 'image'], shell_type: 'shell_command' })
  if (row.baseInstructions?.trim())
    entry.base_instructions = row.baseInstructions.trim()
  if (row.supportsParallelToolCalls !== undefined)
    entry.supports_parallel_tool_calls = row.supportsParallelToolCalls
  applyReasoning(entry, row)
  return entry
}

/**
 * An entry for a Chat provider behind Anna's routing, from Codex's classic GPT entry: the routing turns its custom
 * tools (the freeform apply_patch) into plain functions, so they stay. Strict Chat gateways reject `original` image
 * detail, so Codex must not ask for it. Unlike cc-switch, MCP tools are listed up front rather than behind
 * `tool_search`, as on the native profile: Anna's own tools (memory, delegation) must be in front of the model every
 * turn, not one search away.
 */
function chatEntry(row: CatalogRow, index: number): Entry {
  const entry: Entry = structuredClone(classicTemplate)
  const name = row.displayName ?? row.model
  const window = row.contextWindow ?? 128_000
  Object.assign(entry, { slug: row.model, visibility: 'list', display_name: name, description: name, context_window: window, max_context_window: window, priority: 1000 + index, additional_speed_tiers: [], service_tiers: [], availability_nux: null, upgrade: null, input_modalities: row.inputModalities?.length ? row.inputModalities : ['text', 'image'], supports_image_detail_original: false, supports_search_tool: false })
  applyReasoning(entry, row)
  return entry
}

/** An entry from a vendor's official catalog: matched by slug (an unknown model copies the flagship), rows override. */
function vendorEntry(vendor: Entry[], row: CatalogRow, index: number): Entry {
  const matched = vendor.find(entry => String(entry.slug).toLowerCase() === row.model.toLowerCase())
  const entry: Entry = structuredClone(matched ?? vendor[0]!)
  if (!matched) {
    const name = row.displayName ?? row.model
    Object.assign(entry, { slug: row.model, display_name: name, description: name, priority: 1000 + index, input_modalities: row.inputModalities?.length ? row.inputModalities : ['text', 'image'] })
  }
  if (row.displayName)
    entry.display_name = row.displayName
  if (row.contextWindow)
    Object.assign(entry, { context_window: row.contextWindow, max_context_window: row.contextWindow })
  if (row.inputModalities?.length)
    entry.input_modalities = row.inputModalities
  if (row.supportsParallelToolCalls !== undefined)
    entry.supports_parallel_tool_calls = row.supportsParallelToolCalls
  if (row.baseInstructions?.trim())
    entry.base_instructions = row.baseInstructions.trim()
  applyReasoning(entry, row)
  // Fields Codex's catalog parser requires; an older vendor file may lack them.
  entry.supports_reasoning_summaries ??= nativeTemplate.supports_reasoning_summaries
  entry.supports_parallel_tool_calls ??= nativeTemplate.supports_parallel_tool_calls
  return entry
}

/**
 * The Codex model catalog (`model_catalog_json`) for a third-party provider, ported from cc-switch: tells Codex each
 * model's context window, reasoning levels, image support and tool profile, which it otherwise guesses for any model
 * it doesn't know. Undefined for Codex's own login or a preset without a base URL.
 */
export function codexCatalog(preset: Preset, model?: string): { models: Entry[] } | undefined {
  if (!preset.baseUrl)
    return undefined
  const rows: CatalogRow[] = [...(preset.models ?? [])]
  const chosen = model ?? preset.model
  // The model in use must be listed, first, so Codex finds it.
  if (chosen) {
    const index = rows.findIndex(row => row.model === chosen)
    rows.unshift(index >= 0 ? rows.splice(index, 1)[0]! : { model: chosen })
  }
  if (!rows.length)
    return undefined
  if (preset.apiFormat === 'openai_chat')
    return { models: rows.map(chatEntry) }
  const vendor = officialCatalogs.find(([domain]) => hostMatches(preset.baseUrl!, domain))?.[1]
  return { models: rows.map((row, index) => vendor ? vendorEntry(vendor, row, index) : nativeEntry(row, index)) }
}
