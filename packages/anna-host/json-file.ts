import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/**
 * Keep an unreadable state file, unchanged, where it no longer stops Anna from starting. Never throws: antivirus or a
 * sync client may hold the file, and that must not become a crash at every launch. Returns where it went, if anywhere.
 */
export async function quarantine(path: string, fs: { rename: typeof rename, copyFile: typeof copyFile } = { rename, copyFile }) {
  const target = join(dirname(path), 'quarantine', `${basename(path)}.corrupt-${Date.now()}`)
  try {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await fs.rename(path, target).catch(() => fs.copyFile(path, target))
    console.error(`[anna-core] ${basename(path)} could not be read and was kept at ${target}`)
    return target
  }
  catch (error) {
    console.error(`[anna-core] ${basename(path)} could not be read or set aside`, error instanceof Error ? error.message : '')
    return undefined
  }
}

/**
 * Read Anna's own JSON state. A missing file is the fallback; contents that are not JSON, or fail `valid`, are set aside
 * and are the fallback too; anything else (a folder in its place, no permission) is an error.
 */
export async function readJson<T>(path: string, fallback: T, valid: (value: unknown) => boolean = () => true): Promise<T> {
  let text: string
  try { text = await readFile(path, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return fallback
    throw error
  }
  try {
    const value = JSON.parse(text) as unknown
    if (valid(value))
      return value as T
  }
  catch {}
  // Starting with the fallback would let the next save replace the only copy.
  if (!(await quarantine(path)))
    throw new Error(`${basename(path)} could not be read or set aside`)
  return fallback
}

/** For state kept as a list of records: `[null]` is valid JSON that would still fail on first use. */
export function isRecordList(value: unknown) {
  return Array.isArray(value) && value.every(item => typeof item === 'object' && item !== null)
}

/** Replace the file atomically and keep it private to the user. */
export async function writeJson(path: string, value: unknown) {
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 1), { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}
