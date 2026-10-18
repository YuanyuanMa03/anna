import type { Json } from './json'
import { Buffer } from 'node:buffer'
import { canonicalJson, isObject, str } from './json'

/**
 * Chat Completions can't carry images or files in a tool result. Ported from cc-switch's `tool_media.rs`: media found in
 * a tool output is replaced with a marker and sent right after the results as a user message, so the model still sees
 * it (and base64 never gets serialized into the text, where it would only burn tokens).
 */
export const mediaMovedMarker = '[anna: tool result media moved to the following user message]'
const wholeDataUrlMinBytes = 8 * 1024
const base64ishMinBytes = 16 * 1024
const maxDepth = 32

type Kind = 'image' | 'file' | 'audio'

const isImageMime = (value: string) => value.slice(0, 6).toLowerCase() === 'image/'
function isImageBase64DataUrl(value: string) {
  const comma = value.indexOf(',')
  if (comma < 0)
    return false
  const header = value.slice(0, comma).toLowerCase()
  return header.startsWith('data:image/') && header.endsWith(';base64')
}
const looksLikeBase64 = (value: string) => value.length >= base64ishMinBytes && /^[\w+/=]+$/.test(value) && !value.includes('_')

function mergeDetail(part: Json, imageUrl: Record<string, Json>) {
  if (imageUrl.detail === undefined && part.detail !== undefined)
    imageUrl.detail = part.detail
  // Strict Chat gateways reject Codex's full-resolution detail.
  if (imageUrl.detail === 'original')
    imageUrl.detail = 'auto'
}

function normalizedImageUrl(part: Json): Record<string, Json> | undefined {
  const value = part.image_url
  let object: Record<string, Json>
  if (typeof value === 'string' && value.trim())
    object = { url: value }
  else if (isObject(value) && typeof value.url === 'string' && value.url.trim())
    object = { ...value }
  else return undefined
  mergeDetail(part, object)
  return object
}

function looseDataImageUrl(part: Json) {
  if (part.type !== undefined)
    return undefined
  const normalized = normalizedImageUrl(part)
  return normalized && String(normalized.url).slice(0, 5).toLowerCase() === 'data:' ? normalized : undefined
}

function sourceIsImage(source: Record<string, Json>) {
  const type = str(source.media_type) ?? str(source.mime_type) ?? str(source.mimeType)
  return type === undefined || isImageMime(type)
}

function typedImageHasPayload(part: Json) {
  if (isObject(part.source) && sourceIsImage(part.source) && ((typeof part.source.url === 'string' && part.source.url.trim()) || (typeof part.source.data === 'string' && part.source.data)))
    return true
  const mime = str(part.mimeType) ?? str(part.mime_type)
  return typeof part.data === 'string' && part.data.length > 0 && mime !== undefined && isImageMime(mime)
}

function typedImageUrl(part: Json): Record<string, Json> | undefined {
  if (isObject(part.source)) {
    if (!sourceIsImage(part.source))
      return undefined
    const source = part.source
    if (typeof source.url === 'string' && source.url.trim()) {
      const object: Record<string, Json> = { url: source.url }
      mergeDetail(part, object)
      return object
    }
    if (typeof source.data === 'string' && source.data) {
      const type = str(source.media_type) ?? str(source.mime_type) ?? str(source.mimeType) ?? 'image/png'
      const object: Record<string, Json> = { url: source.data.slice(0, 11).toLowerCase() === 'data:image/' ? source.data : `data:${type};base64,${source.data}` }
      mergeDetail(part, object)
      return object
    }
  }
  const mime = str(part.mimeType) ?? str(part.mime_type)
  if (typeof part.data !== 'string' || !part.data || !mime || !isImageMime(mime))
    return undefined
  const object: Record<string, Json> = { url: `data:${mime};base64,${part.data}` }
  mergeDetail(part, object)
  return object
}

function kindOf(part: Json): Kind | undefined {
  if (!isObject(part))
    return undefined
  switch (part.type) {
    case 'input_image':
    case 'image_url':
      return normalizedImageUrl(part) ? 'image' : undefined
    case 'input_file':
      return part.file_id !== undefined || part.file_data !== undefined ? 'file' : undefined
    case 'input_audio':
      return isObject(part.input_audio) ? 'audio' : undefined
    case 'image':
      return typedImageHasPayload(part) ? 'image' : undefined
    case undefined:
      return looseDataImageUrl(part) ? 'image' : undefined
  }
}

/** A Responses `input_file` part as a Chat `file` (only file ids and inline data; a bare URL isn't a Chat file). */
export function chatFileFromInputFile(part: Json): Json | undefined {
  if (part?.file_id === undefined && part?.file_data === undefined)
    return undefined
  const file: Record<string, Json> = {}
  for (const key of ['file_id', 'file_data', 'filename']) {
    if (part[key] !== undefined)
      file[key] = part[key]
  }
  return file
}

function chatMediaPart(part: Json): Json | undefined {
  const kind = kindOf(part)
  if (kind === 'image') {
    const url = part.type === 'image' ? typedImageUrl(part) : part.type === undefined ? looseDataImageUrl(part) : normalizedImageUrl(part)
    return url && { type: 'image_url', image_url: url }
  }
  if (kind === 'file') {
    const file = chatFileFromInputFile(part)
    return file && { type: 'file', file }
  }
  if (kind === 'audio')
    return { type: 'input_audio', input_audio: part.input_audio }
}

/** An image block (Anthropic `image`, `image_url`, `input_image`) as a Chat `image_url` part; anything else is undefined. */
export const chatImagePart = (part: Json): Json | undefined => kindOf(part) === 'image' ? chatMediaPart(part) : undefined

function wholeStringImage(value: string): Json | undefined {
  const trimmed = value.trim()
  return trimmed.length >= wholeDataUrlMinBytes && isImageBase64DataUrl(trimmed) ? { type: 'image_url', image_url: { url: trimmed } } : undefined
}

/** Long data URLs and base64 left in a value after its media moved out are replaced with a size note. */
function clampBase64ish(value: Json): Json {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if ((trimmed.length >= wholeDataUrlMinBytes && trimmed.slice(0, 5).toLowerCase() === 'data:') || looksLikeBase64(trimmed))
      return `[anna: omitted ${Buffer.byteLength(value)} bytes]`
    return value
  }
  if (Array.isArray(value))
    return value.map(clampBase64ish)
  if (isObject(value))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clampBase64ish(item)]))
  return value
}

/** Move media out of a tool value (in place); returns the new value and how many parts moved. */
function strip(value: Json, media: Json[], replacement: Json, depth: number): [Json, number] {
  if (depth > maxDepth)
    return [value, 0]
  if (typeof value === 'string') {
    const image = wholeStringImage(value)
    if (image) {
      media.push(image)
      return [mediaMovedMarker, 1]
    }
    const trimmed = value.trim()
    if (!trimmed)
      return [value, 0]
    let parsed: Json
    try { parsed = JSON.parse(trimmed) }
    catch { return [value, 0] }
    const [next, moved] = strip(parsed, media, replacement, depth + 1)
    return moved ? [canonicalJson(clampBase64ish(next)), moved] : [value, 0]
  }
  if (Array.isArray(value)) {
    let total = 0
    const next = value.map((item) => {
      const [stripped, moved] = strip(item, media, replacement, depth + 1)
      total += moved
      return stripped
    })
    return [total ? next : value, total]
  }
  if (isObject(value)) {
    const part = chatMediaPart(value)
    if (part) {
      media.push(part)
      return [structuredClone(replacement), 1]
    }
    if (value.content === undefined)
      return [value, 0]
    const [content, moved] = strip(value.content, media, replacement, depth + 1)
    return moved ? [{ ...value, content }, moved] : [value, 0]
  }
  return [value, 0]
}

/** Strip media from a tool value and clamp leftover base64. */
export function stripToolMedia(value: Json, media: Json[]): [Json, number] {
  const [next, moved] = strip(value, media, { type: 'text', text: mediaMovedMarker }, 0)
  return moved ? [clampBase64ish(next), moved] : [value, 0]
}

/** For a function call's output: the text for the tool message, and the media to send after it. */
export function planToolOutputMedia(output: Json): { content: string, media: Json[] } | undefined {
  const media: Json[] = []
  const [next, moved] = stripToolMedia(output, media)
  if (!moved)
    return undefined
  return { content: typeof output === 'string' ? String(next) : canonicalJson(next), media }
}

export function queueToolMedia(pending: Json[], callId: string, media: Json[]) {
  if (!media.length)
    return
  pending.push({ type: 'text', text: `[anna: media output of tool call ${callId}]` }, ...media)
}

export function flushToolMedia(messages: Json[], pending: Json[]) {
  if (pending.length)
    messages.push({ role: 'user', content: pending.splice(0) })
}
