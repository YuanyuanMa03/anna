import { Buffer } from 'node:buffer'
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

// Linear on purpose: this runs synchronously in the main process, on whatever a window or the core prints.
const secrets: [RegExp, string][] = [
  [/\b(?:sk-[\w-]{8,}|hf_[a-z0-9]{20,}|ms-[a-f0-9-]{20,}|gh[po]_\w{20,}|xox[a-z]-[\w-]{8,})/gi, '***'],
  [/(authorization\\?["']?\s*[:=]\s*\\?["']?)[^"'\\\r\n,;]+/gi, '$1***'],
  [/\b(bearer)\s+[\w.~+/=-]+/gi, '$1 ***'],
  [/((?:api[_-]?key|token|secret|password|passwd|credential)\\?["']?\s*[:=]\s*)(?:\\?"[^"\r\n]*"|'[^'\r\n]*'|[^\s"'\\,;&]+)/gi, '$1***'],
  [/([?&]key=)[^&\s"']+/gi, '$1***'],
]

function redact(text: string) {
  return secrets.reduce((clean, [pattern, mask]) => clean.replace(pattern, mask), text)
}

/** A line longer than this is written in pieces rather than held in memory. */
const longestLine = 64 * 1024

/**
 * What a user can send when Anna fails to start: a packaged app has no console, so without this file a crash leaves
 * nothing behind. Bounded to two files, private to the user, and writing it can never itself stop the app.
 */
export function createAppLog(directory: string, options: { maxBytes?: number, now?: () => Date } = {}) {
  const maxBytes = options.maxBytes ?? 1024 * 1024
  const now = options.now ?? (() => new Date())
  const path = join(directory, 'anna.log')
  const sizeOf = () => {
    try { return statSync(path).size }
    catch { return 0 }
  }
  const write = (source: string, text: string) => {
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      const stamp = now().toISOString()
      const lines = Buffer.from(redact(text.slice(0, longestLine)).split(/\r?\n/).filter(Boolean).map(line => `${stamp} [${source}] ${line}\n`).join(''))
      const size = sizeOf()
      if (size && size + lines.length > maxBytes) {
        try {
          rmSync(`${path}.1`, { force: true })
          renameSync(path, `${path}.1`)
        }
        catch {}
      }
      appendFileSync(path, lines.subarray(-maxBytes), { mode: 0o600 })
    }
    catch {}
  }
  return {
    path,
    write,
    /** For a process's output: whole lines only, so neither a credential nor a character is split between two chunks. */
    stream(source: string) {
      const decoder = new StringDecoder('utf8')
      let pending = ''
      return {
        push(chunk: Buffer) {
          pending += decoder.write(chunk)
          const end = pending.lastIndexOf('\n')
          if (end >= 0) {
            write(source, pending.slice(0, end))
            pending = pending.slice(end + 1)
          }
          if (pending.length > longestLine) {
            write(source, pending)
            pending = ''
          }
        },
        flush() {
          pending += decoder.end()
          if (pending)
            write(source, pending)
          pending = ''
        },
      }
    },
  }
}
