import { createHash } from 'node:crypto'

/**
 * Canonical JSON (keys sorted, no whitespace), as cc-switch's `json_canonical.rs`: tool arguments and results sent
 * upstream are byte-stable across requests, which keeps the provider's prompt cache warm.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined)
    return 'null'
  if (Array.isArray(value))
    return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** A string that holds JSON comes back canonical; anything else as it was. */
export function canonicalizeIfJson(value: string) {
  const trimmed = value.trim()
  if (!trimmed)
    return value
  try { return canonicalJson(JSON.parse(trimmed)) }
  catch { return value }
}

/** Tool-call arguments as a canonical JSON string; empty means `{}`. */
export function canonicalArguments(value: unknown) {
  if (typeof value === 'string')
    return value.trim() ? canonicalizeIfJson(value) : '{}'
  return value === undefined ? '{}' : canonicalJson(value)
}

export const shortSha256 = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

export type Json = any
export const isObject = (value: unknown): value is Record<string, Json> => typeof value === 'object' && value !== null && !Array.isArray(value)
export const str = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined
